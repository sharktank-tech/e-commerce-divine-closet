import { randomUUID } from "crypto";
import {
  buscarPagamento,
  criarPagamentoCartao,
  criarPagamentoPix,
  mapearStatusMp,
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
};

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
    throw new Error(
      "MP_ACCESS_TOKEN não configurado. Defina o token de teste/produção ou volte PAYMENT_DRIVER para mock."
    );
  }
  if (!params.payerEmail) {
    throw new Error("E-mail do pagador é obrigatório no Mercado Pago.");
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
    const pag = await criarPagamentoPix(token, base);
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
      throw new Error(
        "Cartão via Mercado Pago exige tokenização no front (MP_PUBLIC_KEY). O servidor nunca recebe o PAN."
      );
    }
    const pag = await criarPagamentoCartao(token, {
      ...base,
      token: params.cardToken,
      parcelas: params.installments ?? 1,
      bandeira: params.paymentMethodId || "visa",
    });
    const estado = mapearStatusMp(pag.status);
    if (estado === "PAID") {
      return { success: true, paymentId: pag.id, status: "PAID", message: "Pagamento aprovado." };
    }
    return { success: false, paymentId: pag.id, status: "FAILED", message: `Pagamento não aprovado (${pag.statusDetail || pag.status}).` };
  }

  throw new Error(`Método não suportado no Mercado Pago: ${params.method}`);
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
