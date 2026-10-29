import { randomUUID } from "crypto";
import {
  buscarPagamento,
  criarPagamentoCartao,
  criarPagamentoPix,
  mapearStatusMp,
  traduzirErroMp,
  type QrPix,
} from "./mercadopago";

export type PaymentResult = {
  success: boolean;
  paymentId: string;
  status: "PAID" | "PENDING" | "FAILED";
  message: string;
  /** Pix aprovado de forma assíncrona: QR para o checkout exibir. */
  qr?: QrPix;
};

export type PaymentParams = {
  orderId: string;
  amount: number;
  method: string; // card | pix | boleto
  card?: { number?: string; name?: string };
  /** token do cartão (front, public key) — obrigatório p/ cartão no MP */
  cardToken?: string;
  installments?: number;
  paymentMethodId?: string;
  payerEmail?: string;
  /**
   * Chave de idempotência do CHECKOUT, repetida em todo retry da mesma
   * tentativa de compra. Vai para o header `X-Idempotency-Key` do MP: sem
   * ela, cada retry criava um pagamento novo (cobrança duplicada).
   */
  idempotencyKey?: string;
};

/** Erro do gateway real (config/MP): vira 502 com mensagem acionável. */
export class PaymentError extends Error {
  statusCode = 502;
  constructor(message: string) {
    super(message);
    this.name = "PaymentError";
  }
}

function urlNotificacao(): string {
  const base =
    process.env.MP_NOTIFICATION_URL ||
    (process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/pagamentos/webhook`
      : "");
  return base;
}

async function processarMp(params: PaymentParams): Promise<PaymentResult> {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    throw new PaymentError(
      "MP_ACCESS_TOKEN não configurado na Vercel. Adicione a variável e faça redeploy."
    );
  }
  if (!params.payerEmail) {
    throw new PaymentError("E-mail do pagador é obrigatório no Mercado Pago.");
  }
  const notificacao = urlNotificacao();
  const base = {
    valor: params.amount,
    email: params.payerEmail,
    referenciaExterna: params.orderId,
    descricao: `Pedido ${params.orderId.slice(0, 32)}`,
    urlNotificacao: notificacao,
  };

  if (params.method === "pix") {
    let pag;
    try {
      pag = await criarPagamentoPix(token, base, params.idempotencyKey || params.orderId);
    } catch (err) {
      throw new PaymentError(traduzirErroMp(err instanceof Error ? err.message : "Falha no Pix (Mercado Pago)."));
    }
    if (!pag.id || ["undefined", "null"].includes(pag.id)) throw new PaymentError("Resposta incompleta do provedor; pagamento será reconciliado.");
    const estado = mapearStatusMp(pag.status);
    if (estado === "PAID") {
      return { success: true, paymentId: pag.id, status: "PAID", message: "Pix aprovado." };
    }
    if (estado === "PENDING") {
      return {
        success: true,
        paymentId: pag.id,
        status: "PENDING",
        message: "Aguardando pagamento do Pix.",
        qr: pag.qr,
      };
    }
    return { success: false, paymentId: pag.id, status: "FAILED", message: `Pix não aprovado (${pag.statusDetail || pag.status}).` };
  }

  if (params.method === "card") {
    if (!params.cardToken) {
      throw new PaymentError(
        "Cartão via Mercado Pago exige tokenização no front (MP_PUBLIC_KEY ausente ou SDK não carregou). Confira a public key na Vercel e recarregue o checkout."
      );
    }
    let pag;
    try {
      pag = await criarPagamentoCartao(token, {
        ...base,
        token: params.cardToken,
        parcelas: params.installments ?? 1,
        bandeira: params.paymentMethodId || "visa",
      }, params.idempotencyKey || params.orderId);
    } catch (err) {
      throw new PaymentError(traduzirErroMp(err instanceof Error ? err.message : "Falha no cartão (Mercado Pago)."));
    }
    // CORREÇÃO (defeito #1 do diagnóstico): `pending`/`in_process` NÃO é
    // recusa. Cartão em análise antifraude devolve `in_process` no momento da
    // criação e só depois vira `approved` — tratava-se aqui como FAILED, o
    // cancelava o pedido, e quando o MP aprovava o webhook não encontrava o
    // pedido (já CANCELLED) e descartava o pagamento. Agora vira PENDING: o
    // pedido fica aguardando e a confirmação chega pelo webhook ou pela
    // reconciliação.
    if (!pag.id || ["undefined", "null"].includes(pag.id)) throw new PaymentError("Resposta incompleta do provedor; pagamento será reconciliado.");
    const estado = mapearStatusMp(pag.status);
    if (estado === "PAID") {
      return { success: true, paymentId: pag.id, status: "PAID", message: "Pagamento aprovado." };
    }
    if (estado === "PENDING") {
      return {
        success: true,
        paymentId: pag.id,
        status: "PENDING",
        message: "Pagamento em análise. Você será notificado quando for aprovado.",
      };
    }
    return { success: false, paymentId: pag.id, status: "FAILED", message: `Pagamento não aprovado (${pag.statusDetail || pag.status}).` };
  }

  throw new PaymentError(`Método não suportado no Mercado Pago: ${params.method}`);
}

/**
 * Gateway de pagamento sandbox/mock.
 * TODO-CLIENTE: gateway de pagamento real (Stripe, Mercado Pago, etc.) + credenciais.
 */
export async function processPayment(params: PaymentParams): Promise<PaymentResult> {
  const driver = process.env.PAYMENT_DRIVER || "mock";

  if (driver === "mercadopago") return processarMp(params);

  if (driver !== "mock") {
    throw new Error(`Gateway de pagamento não suportado: ${driver}`);
  }

  await new Promise((r) => setTimeout(r, 600));

  // Pix/boleto sempre aprovados no sandbox
  if (params.method === "pix" || params.method === "boleto") {
    return {
      success: true,
      paymentId: `pay_${randomUUID()}`,
      status: "PAID",
      message: `Pagamento via ${params.method.toUpperCase()} aprovado (sandbox).`,
    };
  }

  const cardNumber = params.card?.number?.replace(/\s+/g, "") || "";

  if (cardNumber && cardNumber.startsWith("4000")) {
    return {
      success: false,
      paymentId: `pay_${randomUUID()}`,
      status: "FAILED",
      message: "Pagamento recusado (cartão de teste 4000*).",
    };
  }

  return {
    success: true,
    paymentId: `pay_${randomUUID()}`,
    status: "PAID",
    message: "Pagamento aprovado (sandbox).",
  };
}
