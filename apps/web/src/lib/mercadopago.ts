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
  input: Parameters<typeof montarPix>[0],
  idempotencyKey?: string
): Promise<PagamentoMp> {
  const r = (await mpFetch(token, "/v1/payments", {
    method: "POST",
    body: JSON.stringify(montarPix(input)),
  }, idempotencyKey)) as Record<string, unknown>;
  return {
    id: String(r.id),
    status: String(r.status),
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

/**
 * Busca um pagamento pelo external_reference (recovery por lost-response).
 * Retorna o primeiro resultado encontrado ou null.
 */
export async function buscarPagamentoPorReferencia(
  token: string,
  referenciaExterna: string
): Promise<{ id: string; status: string; referenciaExterna: string | null } | null> {
  const r = (await mpFetch(
    token,
    `/v1/payments/search?external_reference=${encodeURIComponent(referenciaExterna)}&criteria=desc&sort=date_created`
  )) as { results?: unknown };
  const lista = Array.isArray(r.results) ? r.results : [];
  if (lista.length === 0) return null;
  const maisRecente = lista[0] as Record<string, unknown>;
  if (maisRecente == null || maisRecente.id == null) return null;
  return {
    id: String(maisRecente.id),
    status: String(maisRecente.status),
    referenciaExterna:
      typeof maisRecente.external_reference === "string" ? maisRecente.external_reference : null,
  };
}

/**
 * Valida a identidade do pagamento comparando os dados do webhook com o pedido.
 * recoveryContext:
 * - "webhook": validação rigorosa (paymentId deve corresponder)
 * - "reconciliacao": lost-response recovery (aceita external_reference como confirmação)
 */
export function validarIdentidadePagamento(
  pagamento: { id: string; status: string; referenciaExterna: string | null; currencyId?: string | null; transactionAmount?: number | null },
  pedido: { id: string; total: number | string; paymentId: string | null },
  recoveryContext: "webhook" | "reconciliacao" = "webhook"
): { ok: boolean; tipo?: "associacao" | "moeda" | "valor"; detalhe?: string } {
  // Caso 1: paymentId ausente (resposta perdida)
  if (!pedido.paymentId) {
    if (recoveryContext === "reconciliacao") {
      if (pagamento.referenciaExterna !== pedido.id) {
        return {
          ok: false,
          tipo: "associacao",
          detalhe: `external_reference ${pagamento.referenciaExterna} não corresponde ao pedido ${pedido.id} (recuperação por referência perdida)`,
        };
      }
    } else {
      console.error(
        `[webhook:divergencia-associacao]`,
        `paymentId ausente no pedido ${pedido.id} — webhook ignorado`
      );
      return {
        ok: false,
        tipo: "associacao",
        detalhe: `paymentId ausente no pedido ${pedido.id}; webhook ignorado por segurança`,
      };
    }
  }

  // Caso 2: Verificação de associação (paymentId)
  if (pedido.paymentId) {
    if (pedido.paymentId !== pagamento.id) {
      if (recoveryContext === "webhook") {
        return {
          ok: false,
          tipo: "associacao",
          detalhe: `pedido ${pedido.id} já referencia o pagamento ${pedido.paymentId}; a notificação descreve o pagamento ${pagamento.id}`,
        };
      }
      // Em reconciliacao: se external_reference confirmar, permite prosseguir
      const externalConfirmada = !!pagamento.referenciaExterna && pagamento.referenciaExterna === pedido.id;
      if (!externalConfirmada) {
        console.warn(
          `[reconciliar:divergencia-associacao]`,
          `paymentId mismatch: pedido ${pedido.id} tem ${pedido.paymentId}, pagamento notify tem ${pagamento.id}`
        );
      }
    }
  }

  // Validação de moeda
  if (pagamento.currencyId != null && pagamento.currencyId !== "BRL") {
    return {
      ok: false,
      tipo: "moeda",
      detalhe: `moeda ${pagamento.currencyId} (esperado BRL) no pagamento ${pagamento.id}`,
    };
  }

  // Validação de valor ( tolerância de 1 centavo)
  if (pagamento.transactionAmount != null) {
    const totalPedido = Math.round(Number(pedido.total) * 100) / 100;
    const valor = Math.round(pagamento.transactionAmount * 100) / 100;
    if (Math.abs(valor - totalPedido) >= 0.01) {
      return {
        ok: false,
        tipo: "valor",
        detalhe: `valor ${valor.toFixed(2)} ≠ total do pedido ${totalPedido.toFixed(2)} (pagamento ${pagamento.id}, pedido ${pedido.id})`,
      };
    }
  }

  return { ok: true };
}
