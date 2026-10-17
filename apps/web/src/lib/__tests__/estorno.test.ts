import { beforeEach, describe, expect, it, vi } from "vitest";

// Orquestração de estorno: o pedido só vira REFUNDED com confirmação real
// do provedor; respostas incertas ficam REQUESTED + reconciliação; reenvio
// reusa a chave de idempotência; erros 4xx = recusado.
const { prismaMock, criarEstornoMock, listarEstornosMock, enfileirarEmailMock, processarOutboxMock } =
  vi.hoisted(() => ({
    prismaMock: {
      order: { findUnique: vi.fn(), updateMany: vi.fn() },
      refund: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    },
    criarEstornoMock: vi.fn(),
    listarEstornosMock: vi.fn(),
    enfileirarEmailMock: vi.fn(),
    processarOutboxMock: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/mercadopago", () => ({
  criarEstornoMp: criarEstornoMock,
  listarEstornosMp: listarEstornosMock,
  traduzirErroMp: (m: string) => m,
}));
vi.mock("@/lib/email-outbox", () => ({
  enfileirarEmailStatusPedido: enfileirarEmailMock,
  processarEmailOutbox: processarOutboxMock,
}));

import {
  EstornoErro,
  confirmarEstornoNotificado,
  reconciliarEstorno,
  sanitizarErro,
  solicitarEstorno,
} from "@/lib/estorno";

const TOKEN = "APP_USR-test-token";

function orderFake(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    number: "DC-1",
    status: "PAID",
    paymentStatus: "PAID",
    paymentMethod: "PIX",
    paymentId: "111",
    total: 100,
    ...overrides,
  };
}

function refundFake(overrides: Record<string, unknown> = {}) {
  return {
    id: "refund-1",
    orderId: "order-1",
    paymentId: "111",
    amount: 100,
    status: "REQUESTED",
    mpRefundId: null,
    attempt: 1,
    idempotencyKey: "key-1",
    requestedBy: "admin-1",
    lastError: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.refund.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.refund.create.mockResolvedValue(refundFake());
  listarEstornosMock.mockResolvedValue({ ok: true, refunds: [] });
  enfileirarEmailMock.mockResolvedValue("outbox-1");
  processarOutboxMock.mockResolvedValue("ENVIADO");
});

describe("solicitarEstorno — validações", () => {
  it("pedido não pago → NAO_PAGA (nunca tenta estornar)", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake({ paymentStatus: "PENDING" }));
    await expect(
      solicitarEstorno({ orderId: "order-1", token: TOKEN })
    ).rejects.toMatchObject({ codigo: "NAO_PAGA" });
    expect(criarEstornoMock).not.toHaveBeenCalled();
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("pedido já REFUNDED → 409 JA_ESTORNADO", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake({ paymentStatus: "REFUNDED" }));
    await expect(
      solicitarEstorno({ orderId: "order-1", token: TOKEN })
    ).rejects.toMatchObject({ codigo: "JA_ESTORNADO", httpStatus: 409 });
    expect(criarEstornoMock).not.toHaveBeenCalled();
  });

  it("sem MP_ACCESS_TOKEN → 503 SEM_TOKEN", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    await expect(
      solicitarEstorno({ orderId: "order-1", token: null })
    ).rejects.toMatchObject({ codigo: "SEM_TOKEN", httpStatus: 503 });
    expect(criarEstornoMock).not.toHaveBeenCalled();
  });
});

describe("solicitarEstorno — caminho feliz", () => {
  it("aprovado no provedor → APPROVED + pedido REFUNDED (guarda por status)", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.refund.findUnique.mockResolvedValue(null);
    criarEstornoMock.mockResolvedValue({
      ok: true,
      refund: { id: "mp-refund-9", status: "approved", amount: 100 },
    });
    // após aplicarResultado, a leitura final devolve o registro aprovado
    prismaMock.refund.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(refundFake({ status: "APPROVED", mpRefundId: "mp-refund-9" }));

    const registro = await solicitarEstorno({ orderId: "order-1", adminId: "admin-1", token: TOKEN });

    expect(registro.status).toBe("APPROVED");
    expect(prismaMock.refund.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: "order-1", status: "REQUESTED" }),
      })
    );
    // pedido marcado só com guarda: PAID→REFUNDED e status seguro→REFUNDED
    expect(prismaMock.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ paymentStatus: "PAID" }) })
    );
    expect(prismaMock.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["PENDING", "PAID", "PROCESSING"] } }),
      })
    );
    // chave de idempotência enviada ao provedor
    expect(criarEstornoMock).toHaveBeenCalledWith(TOKEN, "111", expect.any(String));
  });

  it("refund in_process (Pix) → IN_PROCESS e pedido INTACTO", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.refund.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(refundFake({ status: "IN_PROCESS" }));
    criarEstornoMock.mockResolvedValue({
      ok: true,
      refund: { id: "mp-refund-2", status: "in_process", amount: 100 },
    });

    const registro = await solicitarEstorno({ orderId: "order-1", token: TOKEN });
    expect(registro.status).toBe("IN_PROCESS");
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });
});

describe("solicitarEstorno — falhas do provedor", () => {
  it("4xx → REJECTED + erro RECUSADO; pedido intacto", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.refund.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(refundFake({ status: "REJECTED" }));
    criarEstornoMock.mockResolvedValue({
      ok: false,
      httpStatus: 400,
      motivo: "cannot refund",
    });

    await expect(solicitarEstorno({ orderId: "order-1", token: TOKEN })).rejects.toMatchObject({
      codigo: "RECUSADO",
    });
    expect(prismaMock.refund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["REQUESTED", "REJECTED"] } }),
        data: expect.objectContaining({ status: "REJECTED" }),
      })
    );
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("timeout/incerto → REQUESTED com lastError + erro CONFIRMACAO_INCERTA", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.refund.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(refundFake({ status: "REQUESTED" }));
    criarEstornoMock.mockResolvedValue({ ok: false, incerto: true, motivo: "timeout" });

    await expect(solicitarEstorno({ orderId: "order-1", token: TOKEN })).rejects.toMatchObject({
      codigo: "CONFIRMACAO_INCERTA",
      httpStatus: 502,
    });
    expect(prismaMock.refund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "REQUESTED" }),
        data: expect.objectContaining({ lastError: expect.any(String) }),
      })
    );
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("retry de REQUESTED: reconcilia primeiro e acha refund approved → SEM novo POST", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.refund.findUnique
      .mockResolvedValueOnce(refundFake({ status: "REQUESTED" }))
      .mockResolvedValue(refundFake({ status: "APPROVED", mpRefundId: "mp-7" }));
    listarEstornosMock.mockResolvedValue({
      ok: true,
      refunds: [{ id: "mp-7", status: "approved", amount: 100 }],
    });

    const registro = await solicitarEstorno({ orderId: "order-1", token: TOKEN });
    expect(registro.status).toBe("APPROVED");
    expect(criarEstornoMock).not.toHaveBeenCalled();
    expect(prismaMock.order.updateMany).toHaveBeenCalled();
  });

  it("retry de REQUESTED sem refund no provedor → reenvio com a MESMA chave", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.refund.findUnique
      .mockResolvedValueOnce(refundFake({ status: "REQUESTED", idempotencyKey: "mesma-key" }))
      .mockResolvedValue(refundFake({ status: "APPROVED", idempotencyKey: "mesma-key" }));
    listarEstornosMock.mockResolvedValue({ ok: true, refunds: [] });
    criarEstornoMock.mockResolvedValue({
      ok: true,
      refund: { id: "mp-8", status: "approved", amount: 100 },
    });

    await solicitarEstorno({ orderId: "order-1", token: TOKEN });
    expect(criarEstornoMock).toHaveBeenCalledWith(TOKEN, "111", "mesma-key");
  });

  it("novo POST após REJECTED usa chave NOVA e incrementa tentativa", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.refund.findUnique
      .mockResolvedValueOnce(refundFake({ status: "REJECTED", idempotencyKey: "velha" }))
      .mockResolvedValue(refundFake({ status: "APPROVED", idempotencyKey: "nova" }));
    criarEstornoMock.mockResolvedValue({
      ok: true,
      refund: { id: "mp-9", status: "approved", amount: 100 },
    });

    await solicitarEstorno({ orderId: "order-1", token: TOKEN });
    const [, , chaveEnviada] = criarEstornoMock.mock.calls[0];
    expect(chaveEnviada).not.toBe("velha");
    expect(prismaMock.refund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "REJECTED" }),
        data: expect.objectContaining({ idempotencyKey: chaveEnviada, attempt: { increment: 1 } }),
      })
    );
  });

  it("registro já APPROVED → 409 sem chamar o provedor", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.refund.findUnique.mockResolvedValue(refundFake({ status: "APPROVED" }));
    await expect(
      solicitarEstorno({ orderId: "order-1", token: TOKEN })
    ).rejects.toMatchObject({ codigo: "JA_ESTORNADO", httpStatus: 409 });
    expect(criarEstornoMock).not.toHaveBeenCalled();
  });

  it("409 do provedor → IN_PROCESS (refund em curso)", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.refund.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(refundFake({ status: "IN_PROCESS" }));
    criarEstornoMock.mockResolvedValue({ ok: false, httpStatus: 409, motivo: "refund_in_progress" });

    const registro = await solicitarEstorno({ orderId: "order-1", token: TOKEN });
    expect(registro.status).toBe("IN_PROCESS");
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("corrida na criação (P2002) → 409 EM_ANDAMENTO", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.refund.findUnique.mockResolvedValue(null);
    const err = Object.assign(new Error("unique"), { code: "P2002" });
    prismaMock.refund.create.mockRejectedValue(err);

    await expect(
      solicitarEstorno({ orderId: "order-1", token: TOKEN })
    ).rejects.toMatchObject({ codigo: "EM_ANDAMENTO", httpStatus: 409 });
    expect(criarEstornoMock).not.toHaveBeenCalled();
  });
});

describe("reconciliarEstorno", () => {
  it("REQUESTED sem refund no provedor → confirmado false (estado não muda)", async () => {
    prismaMock.refund.findUnique.mockResolvedValue(refundFake({ status: "REQUESTED" }));
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    listarEstornosMock.mockResolvedValue({ ok: true, refunds: [] });

    const r = await reconciliarEstorno({ orderId: "order-1", token: TOKEN });
    expect(r.confirmado).toBe(false);
    expect(r.registro.status).toBe("REQUESTED");
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("refund approved no provedor → APPROVED + pedido REFUNDED", async () => {
    prismaMock.refund.findUnique
      .mockResolvedValueOnce(refundFake({ status: "IN_PROCESS" }))
      .mockResolvedValue(refundFake({ status: "APPROVED" }));
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    listarEstornosMock.mockResolvedValue({
      ok: true,
      refunds: [{ id: "mp-1", status: "approved", amount: 100 }],
    });

    const r = await reconciliarEstorno({ orderId: "order-1", token: TOKEN });
    expect(r.confirmado).toBe(true);
    expect(r.registro.status).toBe("APPROVED");
    expect(prismaMock.order.updateMany).toHaveBeenCalled();
    expect(enfileirarEmailMock).toHaveBeenCalledTimes(1);
    expect(enfileirarEmailMock).toHaveBeenCalledWith("order-1", "REFUNDED");
    await new Promise((r) => setTimeout(r, 0));
    expect(processarOutboxMock).toHaveBeenCalledTimes(1);
    expect(processarOutboxMock).toHaveBeenCalledWith("outbox-1");
  });

  it("sem transição de estado (guard 0) → não repete e-mail REFUNDED", async () => {
    prismaMock.refund.findUnique
      .mockResolvedValueOnce(refundFake({ status: "IN_PROCESS" }))
      .mockResolvedValue(refundFake({ status: "APPROVED" }));
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.order.updateMany.mockResolvedValue({ count: 0 });
    listarEstornosMock.mockResolvedValue({
      ok: true,
      refunds: [{ id: "mp-1", status: "approved", amount: 100 }],
    });

    const r = await reconciliarEstorno({ orderId: "order-1", token: TOKEN });
    expect(r.confirmado).toBe(true);
    expect(enfileirarEmailMock).not.toHaveBeenCalled();
    expect(processarOutboxMock).not.toHaveBeenCalled();
  });

  it("APPROVED local → retorna sem consultar o provedor", async () => {
    prismaMock.refund.findUnique.mockResolvedValue(refundFake({ status: "APPROVED" }));
    const r = await reconciliarEstorno({ orderId: "order-1", token: TOKEN });
    expect(r.confirmado).toBe(true);
    expect(listarEstornosMock).not.toHaveBeenCalled();
  });

  it("sem registro de estorno → 404 SEM_ESTORNO", async () => {
    prismaMock.refund.findUnique.mockResolvedValue(null);
    await expect(
      reconciliarEstorno({ orderId: "order-1", token: TOKEN })
    ).rejects.toMatchObject({ codigo: "SEM_ESTORNO" });
  });
});

describe("confirmarEstornoNotificado (webhook refunded)", () => {
  it("aprova registro pendente e marca pedido REFUNDED com guarda", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.refund.findUnique.mockResolvedValue(refundFake({ status: "IN_PROCESS" }));

    await confirmarEstornoNotificado({ paymentId: "111", orderId: "order-1" });

    expect(prismaMock.refund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orderId: "order-1", status: { not: "APPROVED" } }),
        data: expect.objectContaining({ status: "APPROVED" }),
      })
    );
    expect(prismaMock.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1", paymentStatus: "PAID" },
        data: { paymentStatus: "REFUNDED" },
      })
    );
    expect(prismaMock.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1", status: { in: ["PENDING", "PAID", "PROCESSING"] } },
        data: { status: "REFUNDED" },
      })
    );
    expect(enfileirarEmailMock).toHaveBeenCalledTimes(1);
    expect(enfileirarEmailMock).toHaveBeenCalledWith("order-1", "REFUNDED");
    await new Promise((r) => setTimeout(r, 0));
    expect(processarOutboxMock).toHaveBeenCalledTimes(1);
    expect(processarOutboxMock).toHaveBeenCalledWith("outbox-1");
  });

  it("notificação repetida (pedido já REFUNDED) → não reenvia e-mail", async () => {
    prismaMock.order.findUnique.mockResolvedValue(
      orderFake({ status: "REFUNDED", paymentStatus: "REFUNDED" })
    );
    prismaMock.refund.findUnique.mockResolvedValue(refundFake({ status: "APPROVED" }));
    prismaMock.order.updateMany.mockResolvedValue({ count: 0 });

    await confirmarEstornoNotificado({ paymentId: "111", orderId: "order-1" });

    expect(enfileirarEmailMock).not.toHaveBeenCalled();
    expect(processarOutboxMock).not.toHaveBeenCalled();
  });

  it("sem registro local → cria histórico (chave estável mp:<paymentId>)", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.refund.findUnique.mockResolvedValue(null);

    await confirmarEstornoNotificado({ paymentId: "111", orderId: "order-1" });

    expect(prismaMock.refund.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "APPROVED",
          idempotencyKey: "mp:111",
          requestedBy: null,
        }),
      })
    );
  });

  it("corrida na criação (P2002) não propaga erro", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    prismaMock.refund.findUnique.mockResolvedValue(null);
    prismaMock.refund.create.mockRejectedValue(
      Object.assign(new Error("dup"), { code: "P2002" })
    );
    await expect(
      confirmarEstornoNotificado({ paymentId: "111", orderId: "order-1" })
    ).resolves.toBeUndefined();
    expect(prismaMock.order.updateMany).toHaveBeenCalled();
  });

  it("sem orderId (sem external_reference) → no-op", async () => {
    await confirmarEstornoNotificado({ paymentId: "111", orderId: null });
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
  });
});

describe("sanitizarErro", () => {
  it("trunca e mascara credenciais longas", () => {
    const s = sanitizarErro(`Bearer ${"a".repeat(60)} falhou ${"x".repeat(500)}`);
    expect(s.length).toBeLessThanOrEqual(300);
    expect(s).not.toContain("Bearer " + "a".repeat(60));
  });
});

it("EstornoErro carrega codigo/status", () => {
  const e = new EstornoErro("NAO_PAGA", "x", 400);
  expect(e.codigo).toBe("NAO_PAGA");
  expect(e.httpStatus).toBe(400);
  expect(e).toBeInstanceOf(Error);
});
