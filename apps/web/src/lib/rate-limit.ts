// Rate limit in-memory por chave (IP/identificador) — uma instância por
// processo (no serverless, cada instância conta separado; suficiente contra
// abuso casual e força bruta lenta. Para limite global, trocar por Redis).
// Retorna { permitido, restantes, resetEm } sem nunca lançar.

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
