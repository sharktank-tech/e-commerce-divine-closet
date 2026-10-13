import { createHmac, randomUUID, timingSafeEqual } from "crypto";

// Webhooks loja → ERP próprio (análise de vendas). Mesmo domínio, base
// configurável (padrão: <APP_URL>/erp/hooks). Fire-and-forget: nunca
// bloqueia o fluxo do pedido; falha só loga. Sem URL ou sem segredo,
// nada é enviado (ERP não configurado = estado normal).

export type EventoErp =
  | "pedido_criado"
  | "pedido_pago"
  | "pedido_cancelado"
  | "estoque_atualizado"
  | "produto_criado"
  | "produto_atualizado";

export type EnvelopeErp = {
  event_id: string;
  tipo: EventoErp;
  ocorrido_em: string;
  dados: Record<string, unknown>;
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
): Promise<boolean> {
  const corpo = JSON.stringify(envelope);
  const ts = Date.now();
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
    if (r.ok) return true;
    throw new Error(`HTTP ${r.status}`);
  } catch (err) {
    if (tentativa >= 3) {
      console.error("[erp:webhook]", envelope.tipo, envelope.event_id, err);
      return false;
    }
    await new Promise((r) => setTimeout(r, 500 * tentativa * tentativa));
    return postar(url, segredo, envelope, tentativa + 1);
  }
}

let avisoConfig = false;

/** Dispara sem bloquear; retorna false se ERP não configurado ou falhou. */
export async function notificarErp(
  tipo: EventoErp,
  dados: Record<string, unknown>
): Promise<boolean> {
  const cfg = config();
  if (!cfg) {
    if (!avisoConfig) {
      avisoConfig = true;
      console.warn("[erp:webhook] ERP não configurado (ERP_WEBHOOK_URL/SECRET) — evento descartado");
    }
    return false;
  }
  return postar(cfg.url, cfg.segredo, {
    event_id: randomUUID(),
    tipo,
    ocorrido_em: new Date().toISOString(),
    dados,
  });
}
