import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

// Webhooks loja → ERP próprio (análise de vendas). Mesmo domínio, base
// configurável (padrão: <APP_URL>/erp/hooks).
//
// Confiabilidade (fila persistente): cada evento é GRAVADO em ErpEvent
// (PK = event_id → idempotente) antes de qualquer envio; a entrega tenta
// na hora (fire-and-forget do fluxo do pedido) e o que falha volta com
// backoff exponencial, drenado pelo cron diário. Sem URL ou sem segredo,
// nada é persistido nem enviado (ERP não configurado = estado normal).

export type EventoErp =
  | "pedido_criado"
  | "pedido_pago"
  | "pedido_cancelado"
  | "pedido_estornado"
  | "estoque_atualizado"
  | "produto_criado"
  | "produto_atualizado";

export type EnvelopeErp = {
  event_id: string;
  /** Versão do contrato do envelope (campo novo, ignora-se em receptores antigos). */
  versao: number;
  tipo: EventoErp;
  ocorrido_em: string;
  dados: Record<string, unknown>;
};

export const ERP_MAX_TENTATIVAS = 5;

type Db = Pick<typeof prisma, "erpEvent">;

type EventoLinha = {
  id: string;
  tipo: string;
  payload: unknown;
  attempt: number;
  status: string;
  nextAttemptAt: Date;
  createdAt: Date;
};

function config(): { url: string; segredo: string } | null {
  const base =
    process.env.ERP_WEBHOOK_URL ||
    (process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/erp/hooks`
      : "");
  const segredo = process.env.ERP_WEBHOOK_SECRET || "";
  if (!base || !segredo) return null;
  return { url: base, segredo };
}

export function assinarEvento(
  corpo: string,
  ts: number,
  segredo: string
): string {
  return createHmac("sha256", segredo).update(`${ts}.${corpo}`).digest("hex");
}

export function verificarAssinaturaErp(
  corpo: string,
  ts: string,
  v1: string,
  segredo: string
): boolean {
  if (!corpo || !ts || !v1 || !segredo) return false;
  const esperado = assinarEvento(corpo, Number(ts), segredo);
  try {
    return timingSafeEqual(Buffer.from(esperado), Buffer.from(v1.toLowerCase()));
  } catch {
    return false;
  }
}

async function postar(
  url: string,
  segredo: string,
  envelope: EnvelopeErp,
  tentativa = 1
): Promise<{ ok: boolean; status: number }> {
  const corpo = JSON.stringify(envelope);
  const ts = Date.now();
  let status = 0;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-erp-evento": envelope.tipo,
        "x-erp-ts": String(ts),
        "x-erp-assinatura": `v1=${assinarEvento(corpo, ts, segredo)}`,
      },
      body: corpo,
      signal: AbortSignal.timeout(10000),
    });
    status = r.status;
    if (r.ok) return { ok: true, status: r.status };
    // 4xx = rejeição determinística (formato/segredo): repetir não resolve —
    // a fila marca FAILED e o reprocesso manual é a saída. 408/429/5xx/rede
    // podem ser transitórios → repetem.
    const transitorio =
      r.status === 408 || r.status === 429 || r.status >= 500;
    if (!transitorio) return { ok: false, status: r.status };
    throw new Error(`HTTP ${r.status}`);
  } catch (err) {
    if (tentativa >= 3) {
      console.error("[erp:webhook]", envelope.tipo, envelope.event_id, err);
      return { ok: false, status };
    }
    await new Promise((r) => setTimeout(r, 500 * tentativa * tentativa));
    return postar(url, segredo, envelope, tentativa + 1);
  }
}

/** True quando há URL + segredo (fila e envio ativos). */
export function erpConfigurado(): boolean {
  return config() !== null;
}

let avisoConfig = false;

function avisoSemConfig() {
  if (!avisoConfig) {
    avisoConfig = true;
    console.warn(
      "[erp:webhook] ERP não configurado (ERP_WEBHOOK_URL/SECRET) — eventos não são persistidos"
    );
  }
}

/**
 * Grava o evento na fila (idempotente pelo event_id). Sem config de ERP:
 * retorna null e NÃO persiste nada.
 */
export async function enfileirarEvento(
  tipo: EventoErp,
  dados: Record<string, unknown>,
  db: Db = prisma
): Promise<string | null> {
  if (!config()) return null;
  const id = randomUUID();
  try {
    await db.erpEvent.create({
      data: { id, tipo, payload: dados, status: "PENDING", attempt: 0 },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return id;
    console.error("[erp:fila:create]", err);
    return null;
  }
  return id;
}

function montarEnvelope(ev: EventoLinha): EnvelopeErp {
  return {
    event_id: ev.id,
    versao: 1,
    tipo: ev.tipo as EventoErp,
    ocorrido_em: ev.createdAt.toISOString(),
    dados: (ev.payload ?? {}) as Record<string, unknown>,
  };
}

async function entregarLinha(
  ev: EventoLinha,
  db: Db
): Promise<boolean> {
  const cfg = config();
  if (!cfg) return false;
  if (ev.status === "DELIVERED" || ev.status === "DEAD") return false;
  if (ev.nextAttemptAt.getTime() > Date.now()) return false;

  const envelope = montarEnvelope(ev);
  const r = await postar(cfg.url, cfg.segredo, envelope);
  const agora = new Date();

  if (r.ok) {
    await db.erpEvent.updateMany({
      where: { id: ev.id, status: { not: "DELIVERED" } },
      data: { status: "DELIVERED", lastStatusCode: r.status, lastError: null },
    });
    return true;
  }

  const attempt = ev.attempt + 1;
  const morto = attempt >= ERP_MAX_TENTATIVAS;
  // 4xx = receptor recusou o formato (FAILED); rede/5xx = PENDING.
  // Ambos voltam a ser drenados até esgotar as tentativas (→ DEAD).
  const proximoStatus = morto ? "DEAD" : r.status >= 400 && r.status < 500 ? "FAILED" : "PENDING";
  const backoffMin = Math.min(2 ** attempt, 60);
  await db.erpEvent.updateMany({
    where: { id: ev.id, status: { not: "DELIVERED" } },
    data: {
      status: proximoStatus,
      attempt,
      nextAttemptAt: new Date(agora.getTime() + backoffMin * 60_000),
      lastStatusCode: r.status || null,
      lastError: `entrega falhou (HTTP ${r.status || "rede"})`,
    },
  });
  if (morto) {
    console.error("[erp:fila] evento esgotou tentativas → DEAD", ev.id, ev.tipo);
  }
  return false;
}

/** Entrega um evento já enfileirado (uma unidade; backoff decidido aqui). */
export async function entregarEvento(id: string, db: Db = prisma): Promise<boolean> {
  const ev = (await db.erpEvent.findUnique({ where: { id } })) as EventoLinha | null;
  if (!ev) return false;
  return entregarLinha(ev, db);
}

/**
 * Drena a fila (PENDING/FAILED vencidos). Roda no cron diário junto do
 * lembrete de carrinho (plano Hobby: 2 crons/dia) e após reprocesso manual.
 */
export async function drenarEventosErp(
  db: Db = prisma
): Promise<{ processados: number; entregues: number }> {
  if (!config()) return { processados: 0, entregues: 0 };
  const eventos = (await db.erpEvent.findMany({
    where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: 100,
  })) as EventoLinha[];

  let entregues = 0;
  for (const ev of eventos) {
    try {
      if (await entregarLinha(ev, db)) entregues++;
    } catch (err) {
      console.error("[erp:fila:dreno]", ev.id, err);
    }
  }
  return { processados: eventos.length, entregues };
}

/**
 * Dispara sem bloquear o fluxo do pedido: enfileira (persistência) e tenta
 * entregar já. Retorna false se ERP não configurado ou se a entrega
 * imediata falhou (a fila continua responsável pelas próximas tentativas).
 */
export async function notificarErp(
  tipo: EventoErp,
  dados: Record<string, unknown>
): Promise<boolean> {
  const cfg = config();
  if (!cfg) {
    avisoSemConfig();
    return false;
  }
  const id = await enfileirarEvento(tipo, dados);
  if (!id) return false;
  try {
    return await entregarEvento(id);
  } catch (err) {
    console.error("[erp:notificar]", tipo, err);
    return false;
  }
}
