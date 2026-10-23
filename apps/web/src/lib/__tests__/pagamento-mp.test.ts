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

function bancoFake(
  statusPagamento: string | null,
  estoque = 10,
  extras: Record<string, unknown> = {}
) {
  // O MESMO pedido serve ao fast-path (db.order.findUnique) e ao reload
  // autoritativo DENTRO da tx (tx.order.findUnique) — na vida real os dois
  // leem a mesma linha; em corrida o reload é quem decide. `status` acompanha
  // o paymentStatus: a guarda de finalização passou a ser por `status`
  // (um pedido em retenção tem paymentStatus=PAID e status=PENDING).
  const pedido =
    statusPagamento == null
      ? null
      : {
          id: "ped-1",
          number: "DC-1",
          status: statusPagamento === "PENDING" ? "PENDING" : statusPagamento,
          paymentStatus: statusPagamento,
          holdCode: null as string | null,
          couponReserved: false,
          userId: null,
          guestEmail: "c@c.com",
          couponCode: "CUPOM10",
          total: 199.9,
          paymentMethod: "PIX",
          user: null,
          ...extras,
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
        };
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const tx = {
    $queryRawUnsafe: vi.fn(async () => []),
    order: {
      findUnique: vi.fn(async () => pedido),
      update: vi.fn(async () => ({})),
      updateMany,
    },
    coupon: {
      // sem maxUses = ilimitado → incrementa normalmente
      findUnique: vi.fn(async () => ({ code: "CUPOM10", maxUses: null, usedCount: 0 })),
      update: vi.fn(async () => ({})),
    },
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
      findUnique: vi.fn(async () => pedido),
      updateMany,
    },
    __tx: tx,
  };
}

describe("finalizarPedidoPago", () => {
  it("PENDING → PAID com baixa de estoque, cupom e sem duplicar", async () => {
    const db = bancoFake("PENDING");
    const r = await finalizarPedidoPago("ped-1", "pay-1", db);
    expect(r).toEqual({ ok: true, jaFinalizado: false, emEspera: false, hold: null });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.__tx.order.update).toHaveBeenCalledWith({
      where: { id: "ped-1" },
      data: {
        status: "PAID",
        paymentStatus: "PAID",
        holdCode: null,
        holdReason: null,
        holdAt: null,
        paymentId: "pay-1",
      },
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

  it("estoque insuficiente: RETÉM (hold) com aprovação gravada, sem baixar estoque", async () => {
    const db = bancoFake("PENDING", 1);
    const r = await finalizarPedidoPago("ped-1", "pay-1", db);
    // Aprovação financeira é GRAVADA (não lança mais 500 no webhook) e o
    // pedido fica em retenção — status permanece PENDING (não fatura).
    expect(r).toEqual({ ok: true, jaFinalizado: false, emEspera: true, hold: "ESTOQUE_INSUFICIENTE" });
    expect(db.__tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: "ped-1", status: "PENDING" },
      data: expect.objectContaining({
        paymentStatus: "PAID",
        paymentId: "pay-1",
        holdCode: "ESTOQUE_INSUFICIENTE",
      }),
    });
    expect(db.__tx.order.update).not.toHaveBeenCalled();
    expect(db.__tx.coupon.update).not.toHaveBeenCalled();
    expect(db.__tx.product.update).not.toHaveBeenCalled();
  });

  it("cupom com reserva na criação (couponReserved): finalização NÃO incrementa de novo", async () => {
    const db2 = bancoFake("PENDING", 10, { couponReserved: true });
    const r = await finalizarPedidoPago("ped-1", "pay-1", db2);
    expect(r.ok).toBe(true);
    expect(r.emEspera).toBe(false);
    // sem incremento de cupom: a vaga já foi consumida na criação do pedido
    expect(db2.__tx.coupon.update).not.toHaveBeenCalled();
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

  // Defeito #1 do diagnóstico: o cartão em análise antifraude devolve
  // `in_process` no momento da criação e só depois vira `approved`. Tratava-se
  // como FAILED, o cancelava o pedido — e quando o MP aprovava, o webhook não
  // encontrava mais o pedido e descartava o pagamento.
  it("cartão in_process → PENDING (não FAILED): pedido fica aguardando o webhook", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ id: 77, status: "in_process", status_detail: "pending_contingency" }),
      }))
    );
    const processPayment = await driverComEnv({
      PAYMENT_DRIVER: "mercadopago",
      MP_ACCESS_TOKEN: "tok",
    });
    const r = await processPayment({
      orderId: "p", amount: 10, method: "card", payerEmail: "c@c.com", cardToken: "tok-card",
    });
    expect(r).toMatchObject({ success: true, status: "PENDING", paymentId: "77" });
    vi.unstubAllGlobals();
    Object.assign(process.env, envAnterior);
  });

  it("cartão pending → PENDING (mesma proteção que in_process)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ id: 78, status: "pending" }) }))
    );
    const processPayment = await driverComEnv({
      PAYMENT_DRIVER: "mercadopago",
      MP_ACCESS_TOKEN: "tok",
    });
    const r = await processPayment({
      orderId: "p", amount: 10, method: "card", payerEmail: "c@c.com", cardToken: "tok-card",
    });
    expect(r).toMatchObject({ success: true, status: "PENDING" });
    vi.unstubAllGlobals();
    Object.assign(process.env, envAnterior);
  });

  it("cartão rejected → FAILED (recusa de verdade continua recusando)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ id: 79, status: "rejected", status_detail: "cc_rejected_other_reason" }),
      }))
    );
    const processPayment = await driverComEnv({
      PAYMENT_DRIVER: "mercadopago",
      MP_ACCESS_TOKEN: "tok",
    });
    const r = await processPayment({
      orderId: "p", amount: 10, method: "card", payerEmail: "c@c.com", cardToken: "tok-card",
    });
    expect(r).toMatchObject({ success: false, status: "FAILED" });
    vi.unstubAllGlobals();
    Object.assign(process.env, envAnterior);
  });

  // Defeito #2: o header X-Idempotency-Key ia com UUID NOVO a cada requisição,
  // anulando a proteção do MP no retry do cliente. Agora a chave do checkout é
  // reutilizada — o mesmo retry devolve o mesmo pagamento.
  it("reusa a chave de idempotência do checkout no header do MP", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 80, status: "pending" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const processPayment = await driverComEnv({
      PAYMENT_DRIVER: "mercadopago",
      MP_ACCESS_TOKEN: "tok",
    });
    const chave = "chk-abcdef123456";
    await processPayment({
      orderId: "p", amount: 10, method: "pix", payerEmail: "c@c.com", idempotencyKey: chave,
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Idempotency-Key"]).toBe(chave);
    vi.unstubAllGlobals();
    Object.assign(process.env, envAnterior);
  });

  it("sem chave do checkout: ainda envia UMA chave (fallback), nunca omite o header", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 81, status: "pending" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const processPayment = await driverComEnv({
      PAYMENT_DRIVER: "mercadopago",
      MP_ACCESS_TOKEN: "tok",
    });
    await processPayment({ orderId: "p", amount: 10, method: "pix", payerEmail: "c@c.com" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Idempotency-Key"]).toBeTruthy();
    vi.unstubAllGlobals();
    Object.assign(process.env, envAnterior);
  });
});
