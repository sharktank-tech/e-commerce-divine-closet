import { createHmac, randomUUID, timingSafeEqual } from "crypto";

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
  const ehPost = String(init?.method || "GET").toUpperCase() === "POST";
  const r = await fetch(`${MP_API}${caminho}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // POST exige chave de idempotência: repetir a mesma chave em retry
      // não duplica pagamento (UUID novo a cada requisição).
      ...(ehPost ? { "X-Idempotency-Key": randomUUID() } : {}),
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

/**
 * Traduz erros conhecidos da API do MP para mensagem acionável (sem vazar
 * detalhe interno). Desconhecido: devolve a mensagem original.
 */
export function traduzirErroMp(mensagem: string): string {
  if (/unauthorized use of live credentials/i.test(mensagem)) {
    return (
      "Credenciais de produção (APP_USR) usadas com dados de teste. " +
      "Para testar, troque as duas chaves pelas de TESTE (TEST-...) no painel do Mercado Pago " +
      "e use cartões/usuários de teste; para cobrar de verdade, use dados reais."
    );
  }
  if (/invalid_token|bad token|token.*expir/i.test(mensagem)) {
    return "Token do Mercado Pago inválido ou expirado. Confira o MP_ACCESS_TOKEN na Vercel e faça redeploy.";
  }
  return mensagem;
}

export function montarPix(input: {
  valor: number;
  email: string;
  referenciaExterna: string;
  descricao: string;
  urlNotificacao?: string | null;
}): Record<string, unknown> {
  return {
    transaction_amount: Math.round(input.valor * 100) / 100,
    description: input.descricao.slice(0, 128),
    payment_method_id: "pix",
    payer: { email: input.email },
    external_reference: input.referenciaExterna,
    // notification_url vazia ("") é rejeitada pela API do MP — omite.
    ...(input.urlNotificacao ? { notification_url: input.urlNotificacao } : {}),
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
  urlNotificacao?: string | null;
}): Record<string, unknown> {
  return {
    token: input.token,
    transaction_amount: Math.round(input.valor * 100) / 100,
    installments: Math.max(1, Math.floor(input.parcelas) || 1),
    payment_method_id: input.bandeira,
    payer: { email: input.email },
    external_reference: input.referenciaExterna,
    description: input.descricao.slice(0, 128),
    ...(input.urlNotificacao ? { notification_url: input.urlNotificacao } : {}),
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
 * Verifica `x-signature: ts=...,v1=...` do webhook. Manifesto OFICIAL do
 * Mercado Pago (SDKs oficiais): `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * — HMAC-SHA256 em hex com o segredo do app; pares vazios são omitidos;
 * só o `data.id` vai em minúsculas. Sem segredo configurado, retorna
 * false (o chamador decide: em produção, exigir).
 */
export function verificarAssinaturaWebhook(
  dataId: string,
  requestId: string,
  ts: string,
  v1: string,
  segredo: string | null | undefined
): boolean {
  if (!segredo || !dataId || !ts || !v1) return false;
  const partes: string[] = [`id:${dataId.toLowerCase()}`];
  if (requestId) partes.push(`request-id:${requestId}`);
  partes.push(`ts:${ts}`);
  const base = `${partes.join(";")};`;
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
