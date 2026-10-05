import { describe, expect, it, vi } from "vitest";
import { finalizarPedidoPago } from "@/lib/pedidos/finalizar";

function bancoFake(statusPagamento: string | null) {
  return {
    order: {
      findUnique: vi.fn(async () =>
        statusPagamento == null
          ? null
          : {
              id: "ped-1",
              number: "DC-1",
              paymentStatus: statusPagamento,
              guestEmail: "c@c.com",
              couponCode: "CUPOM10",
              user: null,
              items: [
                {
                  quantity: 2,
                  size: "M",
                  color: null,
                  product: { id: "prod-1" },
                },
              ],
            }
      ),
      update: vi.fn(async () => ({})),
    },
    coupon: { update: vi.fn(async () => ({})) },
    product: { update: vi.fn(async () => ({})) },
    productVariation: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
  };
}

describe("finalizarPedidoPago", () => {
  it("PENDING → PAID com baixa de estoque, cupom e sem duplicar", async () => {
    const db = bancoFake("PENDING");
    const r = await finalizarPedidoPago("ped-1", "pay-1", db);
    expect(r).toEqual({ ok: true, jaFinalizado: false });
    expect(db.order.update).toHaveBeenCalledWith({
      where: { id: "ped-1" },
      data: { status: "PAID", paymentStatus: "PAID", paymentId: "pay-1" },
    });
    expect(db.coupon.update).toHaveBeenCalledTimes(1);
    expect(db.product.update).toHaveBeenCalledTimes(1);
  });

  it("já PAID: idempotente, sem escrita", async () => {
    const db = bancoFake("PAID");
    const r = await finalizarPedidoPago("ped-1", "pay-1", db);
    expect(r).toEqual({ ok: true, jaFinalizado: true });
    expect(db.order.update).not.toHaveBeenCalled();
    expect(db.coupon.update).not.toHaveBeenCalled();
    expect(db.product.update).not.toHaveBeenCalled();
  });

  it("pedido inexistente: ok false", async () => {
    const db = bancoFake(null);
    const r = await finalizarPedidoPago("x", "pay-1", db);
    expect(r).toEqual({ ok: false, jaFinalizado: false });
  });
});

describe("processPayment (driver)", () => {
  const envAnterior = { ...process.env };

  async function driverComEnv(env: Record<string, string | undefined>) {
    for (const k of ["PAYMENT_DRIVER", "MP_ACCESS_TOKEN"]) delete process.env[k];
    Object.assign(process.env, env);
    vi.resetModules();
    return (await import("@/lib/pagamento")).processPayment;
  }

  it("padrão sem env: mock aprova pix", async () => {
    const processPayment = await driverComEnv({});
    const r = await processPayment({ orderId: "p", amount: 10, method: "pix" });
    expect(r.status).toBe("PAID");
    Object.assign(process.env, envAnterior);
  });

  it("driver desconhecido: erro explícito", async () => {
    const processPayment = await driverComEnv({ PAYMENT_DRIVER: "stripe" });
    await expect(
      processPayment({ orderId: "p", amount: 10, method: "pix" })
    ).rejects.toThrow("não suportado");
    Object.assign(process.env, envAnterior);
  });

  it("mercadopago sem token: erro explícito (fail fast)", async () => {
    const processPayment = await driverComEnv({ PAYMENT_DRIVER: "mercadopago" });
    await expect(
      processPayment({ orderId: "p", amount: 10, method: "pix", payerEmail: "c@c.com" })
    ).rejects.toThrow("MP_ACCESS_TOKEN");
    Object.assign(process.env, envAnterior);
  });

  it("mercadopago com token: chama a API (fetch mockado)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ id: 55, status: "pending" }),
      }))
    );
    const processPayment = await driverComEnv({
      PAYMENT_DRIVER: "mercadopago",
      MP_ACCESS_TOKEN: "tok",
    });
    const r = await processPayment({
      orderId: "p", amount: 10, method: "pix", payerEmail: "c@c.com",
    });
    expect(r).toMatchObject({ status: "PENDING", paymentId: "55" });
    vi.unstubAllGlobals();
    Object.assign(process.env, envAnterior);
  });

  it("cartão MP sem token de cartão: erro explícito (sem PAN no servidor)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const processPayment = await driverComEnv({
      PAYMENT_DRIVER: "mercadopago",
      MP_ACCESS_TOKEN: "tok",
    });
    await expect(
      processPayment({ orderId: "p", amount: 10, method: "card", payerEmail: "c@c.com" })
    ).rejects.toThrow("tokenização");
    vi.unstubAllGlobals();
    Object.assign(process.env, envAnterior);
  });
});
