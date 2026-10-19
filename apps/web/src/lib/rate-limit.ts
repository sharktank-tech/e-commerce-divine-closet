// Rate limit in-memory por chave (IP/identificador) — uma instância por
// processo (no serverless, cada instância conta separado; suficiente contra
// abuso casual e força bruta lenta. Para limite global, trocar por Redis).
// Retorna { permitido, restantes, resetEm } sem nunca lançar.
//
// Para o caso que PRECISA valer entre instâncias (reenvio de link guest),
// há também `consumirRateLimit` abaixo: contador persistido em Postgres.

export type ResultadoLimite = {
  permitido: boolean;
  restantes: number;
  resetEmMs: number;
};

type Faixa = { janelaMs: number; maximo: number };

const baldes = new Map<string, { inicio: number; usados: number }>();

export function verificarLimite(
  chave: string,
  faixa: Faixa,
  agora: number = Date.now()
): ResultadoLimite {
  const atual = baldes.get(chave);
  if (!atual || agora - atual.inicio >= faixa.janelaMs) {
    baldes.set(chave, { inicio: agora, usados: 1 });
    if (baldes.size > 10000) {
      for (const [k, v] of baldes) {
        if (agora - v.inicio >= faixa.janelaMs) baldes.delete(k);
        if (baldes.size <= 8000) break;
      }
    }
    return { permitido: true, restantes: faixa.maximo - 1, resetEmMs: agora + faixa.janelaMs };
  }
  if (atual.usados >= faixa.maximo) {
    return { permitido: false, restantes: 0, resetEmMs: atual.inicio + faixa.janelaMs };
  }
  atual.usados++;
  return {
    permitido: true,
    restantes: faixa.maximo - atual.usados,
    resetEmMs: atual.inicio + faixa.janelaMs,
  };
}

export function respostaLimite(resetEmMs: number): Response {
  const segundos = Math.max(1, Math.ceil((resetEmMs - Date.now()) / 1000));
  return Response.json(
    { error: "Muitas tentativas. Aguarde e tente novamente." },
    { status: 429, headers: { "Retry-After": String(segundos) } }
  );
}

export function chaveIp(req: Request, sufixo: string): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "desconhecido";
  return `${sufixo}:${ip}`;
}

// Fila por chave: serializa tarefas assíncronas da mesma chave (uma
// instância). Usado onde check-then-act precisa ver escritas anteriores
// (ex.: cota) — sem isso, rajadas paralelas passam todas pelo count antes
// de qualquer insert commitar. Entre instâncias distintas resta janela
// residual (documentado); para rigidez total, contador com CHECK no banco.
const filas = new Map<string, Promise<void>>();

export async function naVez<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  const anterior = filas.get(chave) ?? Promise.resolve();
  let liberar!: () => void;
  const atual = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  const encadeada = anterior.then(() => atual);
  filas.set(chave, encadeada);
  await anterior.catch(() => undefined);
  try {
    return await fn();
  } finally {
    liberar();
    if (filas.get(chave) === encadeada) filas.delete(chave);
  }
}

// ---------------------------------------------------------------------------
// Contador PERSISTIDO em Postgres (tabela RateLimit): vale entre instâncias
// serverless, ao contrário do contador em memória acima. Janela fixa com
// início arredondado — sem job de limpeza (janelas antigas simplesmente
// deixam de ser a corrente).

import { prisma } from "@/lib/prisma";

type Db = Pick<typeof prisma, "rateLimit">;

export type ResultadoRateLimit = {
  permitido: boolean;
  /** Tentativas ainda disponíveis na janela corrente (mínimo 0). */
  restantes: number;
};

/**
 * Consome 1 tentativa da `chave` (ex.: `reenviar:ip:203.0.113.9`).
 * `limite` é o máximo de tentativas POR JANELA (padrão: 60 min).
 */
export async function consumirRateLimit(
  chave: string,
  opcoes: { limite: number; janelaMin?: number; db?: Db; agora?: Date }
): Promise<ResultadoRateLimit> {
  const janelaMs = (opcoes.janelaMin ?? 60) * 60_000;
  const agora = opcoes.agora ?? new Date();
  const janelaInicio = new Date(Math.floor(agora.getTime() / janelaMs) * janelaMs);
  const db = opcoes.db ?? prisma;

  const linha = await db.rateLimit.upsert({
    where: { chave_janelaInicio: { chave, janelaInicio } },
    create: { chave, janelaInicio, total: 1 },
    update: { total: { increment: 1 } },
  });
  return {
    permitido: linha.total <= opcoes.limite,
    restantes: Math.max(0, opcoes.limite - linha.total),
  };
}

/**
 * IP do cliente para rate-limit. Em produção (Vercel) `x-real-ip` é gravado
 * pelo edge e não é spoofável pelo cliente; `x-forwarded-for` é usado só
 * como fallback (fora do Vercel pode conter o primeiro hop do cliente —
 * documentado como melhor-esforço, nunca é fonte de autorização).
 */
export function ipDoPedido(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const xff = headers.get("x-forwarded-for");
  const primeiro = xff?.split(",")[0]?.trim();
  if (primeiro) return primeiro.slice(0, 64);
  return "desconhecido";
}
