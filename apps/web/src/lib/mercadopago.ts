import { createHmac, timingSafeEqual } from "crypto";

// Cliente HTTP da API do Mercado Pago (Checkout Transparente) — sem SDK,
// só fetch. Cobertura: Pix + cartão via token (tokenizado no front com a
// public key; o servidor nunca recebe PAN). Sem MP_ACCESS_TOKEN, nada aqui
// é chamado (o driver `mercadopago` exige o token e falha explícito).

export const MP_API = "https://api.mercadopago.com";

export type MetodoMp = "pix" | "card";

export type QrPix = {
  codigo: string;
  base64: string | null;
  ticketUrl: string | null;
};

export type PagamentoMp = {
  id: string;
  status: "approved" | "pending" | "rejected" | "cancelled" | string;
  statusDetail?: string;
  qr?: QrPix;
};

async function mpFetch(
  token: string,
  caminho: string,
  init?: RequestInit
): Promise<unknown> {
  const r = await fetch(`${MP_API}${caminho}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const corpo = await r.json().catch(() => null);
  if (!r.ok) {
    const motivo =
      (corpo as { message?: string } | null)?.message || `HTTP ${r.status}`;
    throw new Error(`Mercado Pago: ${motivo}`);
  }
  return corpo;
}

/** approved → PAID; pending/in_process → PENDENTE; resto → FALHOU. */
export function mapearStatusMp(status: string): "PAID" | "PENDING" | "FAILED" {
  if (status === "approved") return "PAID";
  if (status === "pending" || status === "in_process") return "PENDING";
  return "FAILED";
}

export function montarPix(input: {
  valor: number;
  email: string;
  referenciaExterna: string;
  descricao: string;
  urlNotificacao: string;
}): Record<string, unknown> {
  return {
    transaction_amount: Math.round(input.valor * 100) / 100,
    description: input.descricao.slice(0, 128),
    payment_method_id: "pix",
    payer: { email: input.email },
    external_reference: input.referenciaExterna,
    notification_url: input.urlNotificacao,
  };
}

export function montarCartao(input: {
  token: string;
  valor: number;
  parcelas: number;
  bandeira: string;
  email: string;
  referenciaExterna: string;
  descricao: string;
  urlNotificacao: string;
}): Record<string, unknown> {
  return {
    token: input.token,
    transaction_amount: Math.round(input.valor * 100) / 100,
    installments: Math.max(1, Math.floor(input.parcelas) || 1),
    payment_method_id: input.bandeira,
    payer: { email: input.email },
    external_reference: input.referenciaExterna,
    description: input.descricao.slice(0, 128),
    notification_url: input.urlNotificacao,
  };
}

function lerQr(resposta: Record<string, unknown>): QrPix | undefined {
  const tx = resposta.point_of_interaction as
    | { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } }
    | undefined;
  const dados = tx?.transaction_data;
  if (!dados?.qr_code) return undefined;
  return {
    codigo: dados.qr_code,
    base64: dados.qr_code_base64 ?? null,
    ticketUrl: dados.ticket_url ?? null,
  };
}

export async function criarPagamentoPix(
  token: string,
  input: Parameters<typeof montarPix>[0]
): Promise<PagamentoMp> {
  const r = (await mpFetch(token, "/v1/payments", {
    method: "POST",
    body: JSON.stringify(montarPix(input)),
  })) as Record<string, unknown>;
  return {
    id: String(r.id),
    status: String(r.status),
    statusDetail: typeof r.status_detail === "string" ? r.status_detail : undefined,
    qr: lerQr(r),
  };
}

export async function criarPagamentoCartao(
  token: string,
  input: Parameters<typeof montarCartao>[0]
): Promise<PagamentoMp> {
  const r = (await mpFetch(token, "/v1/payments", {
    method: "POST",
    body: JSON.stringify(montarCartao(input)),
  })) as Record<string, unknown>;
  return {
    id: String(r.id),
    status: String(r.status),
    statusDetail: typeof r.status_detail === "string" ? r.status_detail : undefined,
  };
}

export async function buscarPagamento(
  token: string,
  pagamentoId: string
): Promise<{ id: string; status: string; referenciaExterna: string | null }> {
  const r = (await mpFetch(
    token,
    `/v1/payments/${encodeURIComponent(pagamentoId)}`
  )) as Record<string, unknown>;
  return {
    id: String(r.id),
    status: String(r.status),
    referenciaExterna:
      typeof r.external_reference === "string" ? r.external_reference : null,
  };
}

/**
 * Verifica `x-signature: ts=...,v1=...` do webhook (HMAC-SHA256 de
 * `${dataId};${requestId};${ts}` com o segredo do app). Sem segredo
 * configurado, retorna false (o chamador decide: em produção, exigir).
 */
export function verificarAssinaturaWebhook(
  dataId: string,
  requestId: string,
  ts: string,
  v1: string,
  segredo: string | null | undefined
): boolean {
  if (!segredo || !dataId || !requestId || !ts || !v1) return false;
  const base = `${dataId.toLowerCase()};${requestId.toLowerCase()};${ts}`;
  const esperado = createHmac("sha256", segredo).update(base).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(esperado), Buffer.from(v1.toLowerCase()));
  } catch {
    return false;
  }
}

export function extrairAssinatura(
  cabecalho: string | null
): { ts: string; v1: string } | null {
  if (!cabecalho) return null;
  const partes = Object.fromEntries(
    cabecalho.split(",").map((p) => {
      const i = p.indexOf("=");
      return i < 0 ? [p.trim(), ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  if (!partes.ts || !partes.v1) return null;
  return { ts: partes.ts, v1: partes.v1 };
}
