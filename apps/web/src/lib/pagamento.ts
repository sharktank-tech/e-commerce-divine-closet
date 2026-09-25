import { randomUUID } from "crypto";

export type PaymentResult = {
  success: boolean;
  paymentId: string;
  status: "PAID" | "FAILED";
  message: string;
};

/**
 * Gateway de pagamento sandbox/mock.
 * TODO-CLIENTE: gateway de pagamento real (Stripe, Mercado Pago, etc.) + credenciais.
 */
export async function processPayment(params: {
  orderId: string;
  amount: number;
  method: string; // card | pix | boleto
  card?: { number?: string; name?: string };
}): Promise<PaymentResult> {
  const driver = process.env.PAYMENT_DRIVER || "mock";

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
