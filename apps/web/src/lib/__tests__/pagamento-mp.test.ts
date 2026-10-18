import { describe, expect, it, vi } from "vitest";
import { finalizarPedidoPago } from "@/lib/pedidos/finalizar";

// E-mail "pedido pago" agora sai pelo OUTBOX (dedupeKey única) em vez de
// sendEmail direto — mockável aqui para provar idempotência.
const { enfileirarMock, processarMock } = vi.hoisted(() => ({
  enfileirarMock: vi.fn(),
  processarMock: vi.fn(),
}));
vi.mock("@/lib/email-outbox", () => ({
  dedupeKeyStatusPedido: (orderId: string, status: string) => `status:${orderId}:${status}`,
  enfileirarEmail: enfileirarMock,
  processarEmailOutbox: processarMock,
}));

function bancoFake(statusPagamento: string | null, estoque = 10) {
  const tx = {
    $queryRawUnsafe: vi.fn(async () => []),
    order: { update: vi.fn(async () => ({})) },
    coupon: { update: vi.fn(async () => ({})) },
    product: {
      findMany: vi.fn(async () => [
        { id: "prod-1", stock: estoque, variations: [] },
      ]),
      update: vi.fn(async () => ({})),
    },
    productVariation: { update: vi.fn(async () => ({})) },
  };
  return {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    order: {
      findUnique: vi.fn(async () =>
        statusPagamento == null
          ? null
          : {
              id: "ped-1",
              number: "DC-1",
              paymentStatus: statusPagamento,
              userId: null,
              guestEmail: "c@c.com",
              couponCode: "CUPOM10",
              total: 199.9,
              paymentMethod: "PIX",
              user: null,
              items: [
                {
                  quantity: 2,
                  size: "M",
                  color: null,
                  productName: "Blusa",
                  unitPrice: 99.95,
                  product: { id: "prod-1" },
                },
              ],
            }
      ),
    },
    __tx: tx,
  };
}

describe("finalizarPedidoPago", () => {
  it("PENDING → PAID com baixa de estoque, cupom e sem duplicar", async () => {
    const db = bancoFake("PENDING");
    const r = await finalizarPedidoPago("ped-1", "pay-1", db);
    expect(r).toEqual({ ok: true, jaFinalizado: false });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.__tx.order.update).toHaveBeenCalledWith({
      where: { id: "ped-1" },
      data: { status: "PAID", paymentStatus: "PAID", paymentId: "pay-1" },
    });
    expect(db.__tx.coupon.update).toHaveBeenCalledTimes(1);
    expect(db.__tx.product.update).toHaveBeenCalledTimes(1);
  });

  it("já PAID: idempotente, sem escrita", async () => {
    const db = bancoFake("PAID");
    const r = await finalizarPedidoPago("ped-1", "pay-1", db);
    expect(r).toEqual({ ok: true, jaFinalizado: true });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("pedido inexistente: ok false", async () => {
    const db = bancoFake(null);
    const r = await finalizarPedidoPago("x", "pay-1", db);
    expect(r).toEqual({ ok: false, jaFinalizado: false });
  });

  it("estoque insuficiente na finalização: falha sem escrever", async () => {
    const db = bancoFake("PENDING", 1);
    await expect(finalizarPedidoPago("ped-1", "pay-1", db)).rejects.toThrow(
      "Estoque insuficiente"
    );
    expect(db.__tx.order.update).not.toHaveBeenCalled();
    expect(db.__tx.coupon.update).not.toHaveBeenCalled();
    expect(db.__tx.product.update).not.toHaveBeenCalled();
  });

  it("e-mail 'pedido pago' sai pelo OUTBOX com dedupeKey status:{id}:PAID (não direto)", async () => {
    vi.clearAllMocks();
    enfileirarMock.mockResolvedValue("ob-1");
    processarMock.mockResolvedValue("ENVIADO");
    const db = bancoFake("PENDING");
    await finalizarPedidoPago("ped-1", "pay-1", db);
    // fire-and-forget: espera a microtask do enqueue
    await vi.waitFor(() => expect(enfileirarMock).toHaveBeenCalled());
    expect(enfileirarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: "status:ped-1:PAID",
        kind: "order_paid",
        orderId: "ped-1",
        mail: expect.objectContaining({ to: "c@c.com" }),
      })
    );
    expect(processarMock).toHaveBeenCalledWith("ob-1");
  });

  it("webhook repetido (pedido já PAID) → jaFinalizado e NÃO re-enfileira e-mail", async () => {
    vi.clearAllMocks();
    const db = bancoFake("PAID");
    const r = await finalizarPedidoPago("ped-1", "pay-1", db);
    expect(r).toEqual({ ok: true, jaFinalizado: true });
    await new Promise((s) => setTimeout(s, 5));
    expect(enfileirarMock).not.toHaveBeenCalled();
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

  it("falhas do gateway: PaymentError (vira 502 com mensagem, não 500 genérico)", async () => {
    for (const k of ["PAYMENT_DRIVER", "MP_ACCESS_TOKEN"]) delete process.env[k];
    Object.assign(process.env, { PAYMENT_DRIVER: "mercadopago" });
    vi.resetModules();
    const mod = await import("@/lib/pagamento");
    await expect(
      mod.processPayment({ orderId: "p", amount: 10, method: "pix", payerEmail: "c@c.com" })
    ).rejects.toBeInstanceOf(mod.PaymentError);
    Object.assign(process.env, envAnterior);
  });
});
