import { afterEach, describe, expect, it, vi } from "vitest";
import { classificarPagamento } from "@/lib/checkout/resultado-pagamento";
import { verificarGatewayPagamento, processPayment } from "@/lib/pagamento";
import { pagamentoCheckoutSchema } from "@/lib/checkout/pagamento-schema";

afterEach(() => vi.unstubAllEnvs());

describe("checkout seguro", () => {
  it.each([undefined, "mock", "stripe"])("bloqueia gateway %s em produção antes de simular", async (driver) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENT_DRIVER", driver);
    expect(() => verificarGatewayPagamento()).toThrow();
    await expect(processPayment({ orderId: "teste", amount: 1, method: "pix" })).rejects.toThrow();
  });
  it("aceita explicitamente Mercado Pago em produção", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENT_DRIVER", "mercadopago");
    expect(() => verificarGatewayPagamento()).not.toThrow();
  });
  it("não confirma Pix sem QR, cartão em análise ou resposta incompleta", () => {
    expect(classificarPagamento({ pendente: true, order: { paymentStatus: "PENDING" } })).toBe("pendente");
    expect(classificarPagamento({ order: { paymentStatus: "PENDING" } })).toBe("pendente");
    expect(classificarPagamento({})).toBe("pendente");
    expect(classificarPagamento({ pendente: true, order: { paymentStatus: "PAID" } })).toBe("pendente");
    expect(classificarPagamento({ order: { paymentStatus: "PAID" } })).toBe("pago");
    expect(classificarPagamento({ order: { paymentStatus: "FAILED", status: "CANCELLED" } })).toBe("encerrado");
  });
  it("rejeita dados brutos de cartão e aceita token", () => {
    expect(pagamentoCheckoutSchema.safeParse({ method: "card", card: { number: "4111111111111111", cvv: "123" } }).success).toBe(false);
    expect(pagamentoCheckoutSchema.safeParse({ method: "card", cardNumber: "4111111111111111" }).success).toBe(false);
    expect(pagamentoCheckoutSchema.safeParse({ method: "card", cardToken: "tok_test", installments: 1, paymentMethodId: "visa" }).success).toBe(true);
  });
});
