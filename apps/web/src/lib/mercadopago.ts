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

export type PagamentoConsultado = {
  id: string; status: string; referenciaExterna: string | null;
  currencyId: string | null; transactionAmount: number | null;
};

function lerPagamento(r: Record<string, unknown>): PagamentoConsultado {
  if (r.id == null || !String(r.id).trim() || typeof r.status !== "string" || !r.status) {
    throw new Error("Mercado Pago: resposta incompleta; estado financeiro desconhecido");
  }
  return {
    id: String(r.id), status: r.status,
    referenciaExterna: typeof r.external_reference === "string" ? r.external_reference : null,
    currencyId: typeof r.currency_id === "string" ? r.currency_id : null,
    transactionAmount: typeof r.transaction_amount === "number" && Number.isFinite(r.transaction_amount) ? r.transaction_amount : null,
  };
}

export class PagamentosAmbiguosError extends Error {
  constructor(public readonly paymentIds: string[]) {
    super("Mais de um pagamento aprovado para o pedido; revisão financeira necessária");
  }
}

export type PagamentoMp = {
  id: string;
  status: "approved" | "pending" | "rejected" | "cancelled" | string;
  statusDetail?: string;
  qr?: QrPix;
};

async function mpFetch(
  token: string,
  caminho: string,
  init?: RequestInit,
  idempotencyKey?: string
): Promise<unknown> {
  const ehPost = String(init?.method || "GET").toUpperCase() === "POST";
  const r = await fetch(`${MP_API}${caminho}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // POST exige chave de idempotência: repetir a MESMA chave em retry não
      // duplica pagamento. A chave vem do chamador (geralmente derivada da
      // chave de idempotência do checkout) — um UUID novo a cada requisição,
      // como antes, anulava a proteção no retry do cliente.
      ...(ehPost ? { "X-Idempotency-Key": idempotencyKey || randomUUID() } : {}),
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

/** Só recusa/expiração explícita falha; estado desconhecido permanece pendente. */
export function mapearStatusMp(status: string): "PAID" | "PENDING" | "FAILED" {
  if (status === "approved") return "PAID";
  if (["rejected", "cancelled", "expired", "refused"].includes(status)) return "FAILED";
  return "PENDING";
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
  input: Parameters<typeof montarPix>[0],
  idempotencyKey?: string
): Promise<PagamentoMp> {
  const r = (await mpFetch(token, "/v1/payments", {
    method: "POST",
    body: JSON.stringify(montarPix(input)),
  }, idempotencyKey)) as Record<string, unknown>;
  return {
    id: lerPagamento(r).id,
    status: lerPagamento(r).status,
    statusDetail: typeof r.status_detail === "string" ? r.status_detail : undefined,
    qr: lerQr(r),
  };
}

export async function criarPagamentoCartao(
  token: string,
  input: Parameters<typeof montarCartao>[0],
  idempotencyKey?: string
): Promise<PagamentoMp> {
  const r = (await mpFetch(token, "/v1/payments", {
    method: "POST",
    body: JSON.stringify(montarCartao(input)),
  }, idempotencyKey)) as Record<string, unknown>;
  return {
    id: lerPagamento(r).id,
    status: lerPagamento(r).status,
    statusDetail: typeof r.status_detail === "string" ? r.status_detail : undefined,
  };
}

export async function buscarPagamento(
  token: string,
  pagamentoId: string
): Promise<PagamentoConsultado> {
  const r = await mpFetch(token, `/v1/payments/${encodeURIComponent(pagamentoId)}`) as Record<string, unknown>;
  return lerPagamento(r);
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

// ---------------------------------------------------------------------------
// Estorno de pagamento (refund)
// ---------------------------------------------------------------------------

export type RespostaRefundMp =
  | { ok: true; refund: { id: string; status: string; amount: number | null } }
  // incerto = rede/timeout/5xx: o provedor PODE ter processado — o chamador
  // não deve assumir falha nem sucesso; deve reconciliar antes de reenviar.
  | { ok: false; motivo: string; httpStatus?: number; incerto?: boolean };

/**
 * Solicita estorno INTEGRAL (sem `amount` no corpo) de um pagamento.
 * Headers obrigatórios da API: `X-Idempotency-Key` fixa por tentativa
 * (reenvio com a mesma chave devolve o mesmo resultado — nunca duplica)
 * e `X-Render-In-Process-Refunds` para o Pix aceitar o pedido (201
 * `in_process` em vez de 400 quando a devolução exige render).
 */
export async function criarEstornoMp(
  token: string,
  pagamentoId: string,
  idempotencyKey: string
): Promise<RespostaRefundMp> {
  try {
    const r = await fetch(
      `${MP_API}/v1/payments/${encodeURIComponent(pagamentoId)}/refunds`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
          "X-Render-In-Process-Refunds": "true",
        },
        body: "{}",
        signal: AbortSignal.timeout(20000),
      }
    );
    const corpo = (await r.json().catch(() => null)) as {
      id?: unknown;
      status?: unknown;
      amount?: unknown;
      message?: string;
    } | null;
    if (r.ok) {
      return {
        ok: true,
        refund: {
          id: String(corpo?.id ?? ""),
          status: String(corpo?.status ?? "in_process"),
          amount: corpo?.amount != null ? Number(corpo.amount) : null,
        },
      };
    }
    return {
      ok: false,
      httpStatus: r.status,
      motivo: corpo?.message || `HTTP ${r.status}`,
    };
  } catch (err) {
    // Timeout, DNS, TLS, corpo ilegível: estado desconhecido no provedor.
    return { ok: false, incerto: true, motivo: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Lista os refunds de um pagamento — usada para reconciliar tentativas
 * com resposta perdida/timeout e para o botão "Verificar status".
 */
export async function listarEstornosMp(
  token: string,
  pagamentoId: string
): Promise<
  | { ok: true; refunds: Array<{ id: string; status: string; amount: number | null }> }
  | { ok: false; motivo: string }
> {
  try {
    const r = await fetch(
      `${MP_API}/v1/payments/${encodeURIComponent(pagamentoId)}/refunds`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
      }
    );
    if (!r.ok) {
      const corpo = (await r.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, motivo: corpo?.message || `HTTP ${r.status}` };
    }
    const corpo = (await r.json()) as { data?: unknown };
    const lista = Array.isArray(corpo.data) ? corpo.data : [];
    return {
      ok: true,
      refunds: lista.map((raw) => {
        const c = raw as { id?: unknown; status?: unknown; amount?: unknown };
        return {
          id: String(c.id ?? ""),
          status: String(c.status ?? ""),
          amount: c.amount != null ? Number(c.amount) : null,
        };
      }),
    };
  } catch (err) {
    return { ok: false, motivo: err instanceof Error ? err.message : String(err) };
  }
}

/** Examina todas as páginas limitadas; nunca trata uma lista truncada como ausência. */
export async function buscarPagamentoPorReferencia(
  token: string, referenciaExterna: string
): Promise<PagamentoConsultado | null> {
  const encontrados = new Map<string, PagamentoConsultado>();
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await mpFetch(token,
      `/v1/payments/search?external_reference=${encodeURIComponent(referenciaExterna)}&limit=100&offset=${offset}`
    ) as { results?: unknown; paging?: { total?: number } };
    if (!Array.isArray(r.results)) throw new Error("Mercado Pago: busca incompleta");
    for (const raw of r.results) {
      const p = lerPagamento(raw as Record<string, unknown>);
      if (p.referenciaExterna !== referenciaExterna) throw new Error("Mercado Pago: referência divergente na busca");
      encontrados.set(p.id, p);
    }
    if (r.results.length < 100 && (r.paging?.total ?? 0) <= offset + r.results.length) break;
    if (offset === 900) throw new Error("Mercado Pago: busca truncada; revisão necessária");
  }
  const lista = [...encontrados.values()];
  const aprovados = lista.filter(p => p.status === "approved");
  if (aprovados.length > 1) throw new PagamentosAmbiguosError(aprovados.map(p => p.id));
  if (aprovados.length === 1) return aprovados[0];
  // Uma tentativa ainda ativa impede que uma recusa de outra tentativa cancele o pedido.
  return lista.find(p => !["rejected", "cancelled", "expired", "refused"].includes(p.status)) ?? lista[0] ?? null;
}

/** Todos os caminhos exigem referência exata, BRL e total em centavos. */
export function validarIdentidadePagamento(
  pagamento: { id: string; status: string; referenciaExterna: string | null; currencyId?: string | null; transactionAmount?: number | null },
  pedido: { id: string; total: number | string; paymentId: string | null },
  recoveryContext: "webhook" | "reconciliacao" = "webhook"
): { ok: boolean; tipo?: "associacao" | "moeda" | "valor"; detalhe?: string } {
  if (!pagamento.id || pagamento.referenciaExterna !== pedido.id ||
      (recoveryContext === "webhook" && pedido.paymentId != null && pedido.paymentId !== pagamento.id)) {
    return { ok: false, tipo: "associacao", detalhe: "Referência ou pagamento incompatível com o pedido" };
  }
  if (pagamento.currencyId !== "BRL") return { ok: false, tipo: "moeda", detalhe: "Moeda ausente ou diferente de BRL" };
  const total = Number(pedido.total);
  if (typeof pagamento.transactionAmount !== "number" || !Number.isFinite(pagamento.transactionAmount) ||
      !Number.isFinite(total) || total < 0 ||
      Math.round(pagamento.transactionAmount * 100) !== Math.round(total * 100)) {
    return { ok: false, tipo: "valor", detalhe: "Valor ausente ou diferente do total em centavos" };
  }
  return { ok: true };
}
