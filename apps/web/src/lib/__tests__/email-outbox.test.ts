import { beforeEach, describe, expect, it, vi } from "vitest";

// Outbox de e-mail transacional: payload imutável gravado na enfileiração,
// dedupeKey única (webhook repetido/concordância simultânea = 1 linha),
// SENT só após aceite do provedor, retentativa com backoff para falhas
// transitórias e FAILED definitivo para falha de configuração/validação ou
// tentativas esgotadas. Idempotency-Key = dedupeKey em TODAS as tentativas.
const { prismaMock, sendMock, montarMock } = vi.hoisted(() => ({
  prismaMock: {
    emailOutbox: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  sendMock: vi.fn(),
  montarMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/email", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/email")>();
  return { ...original, sendEmail: sendMock };
});
vi.mock("@/lib/pedidos/notificar-status", () => ({
  montarEmailStatusPedido: montarMock,
}));

import { EmailNaoAceito } from "@/lib/email";
import {
  EMAIL_OUTBOX_MAX_TENTATIVAS,
  dedupeKeyStatusPedido,
  drenarEmailsOutbox,
  enfileirarEmail,
  enfileirarEmailStatusPedido,
  processarEmailOutbox,
} from "@/lib/email-outbox";

function mailFake(overrides: Record<string, unknown> = {}) {
  return {
    to: "cliente@x.com",
    subject: "Pedido DC-1 — Estornado",
    text: "corpo texto",
    html: "<p>corpo</p>",
    ...overrides,
  };
}

function rowFake(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    dedupeKey: "status:o1:REFUNDED",
    orderId: "o1",
    recipient: "cliente@x.com",
    subject: "Pedido DC-1 — Estornado",
    text: "corpo texto",
    html: "<p>corpo</p>",
    status: "PENDING",
    attempt: 0,
    nextAttemptAt: new Date(Date.now() - 1000),
    lastError: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  montarMock.mockResolvedValue(mailFake());
  sendMock.mockResolvedValue({ id: "re_abc" });
  prismaMock.emailOutbox.create.mockResolvedValue({ id: "row-1" });
  prismaMock.emailOutbox.updateMany.mockResolvedValue({ count: 1 });
});

describe("enfileirarEmailStatusPedido", () => {
  it("grava PENDING com payload imutável e dedupeKey estável da ocorrência", async () => {
    const id = await enfileirarEmailStatusPedido("o1", "REFUNDED");

    expect(id).toBe("row-1");
    expect(montarMock).toHaveBeenCalledWith(
      { orderId: "o1", status: "REFUNDED" },
      expect.anything()
    );
    expect(prismaMock.emailOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dedupeKey: "status:o1:REFUNDED",
        kind: "status_pedido",
        orderId: "o1",
        recipient: "cliente@x.com",
        subject: "Pedido DC-1 — Estornado",
        text: "corpo texto",
        html: "<p>corpo</p>",
        status: "PENDING",
        attempt: 0,
        nextAttemptAt: expect.any(Date),
      }),
    });
    expect(dedupeKeyStatusPedido("o1", "REFUNDED")).toBe("status:o1:REFUNDED");
  });

  it("sem destinatário (montar null) → não grava nada", async () => {
    montarMock.mockResolvedValue(null);
    await expect(enfileirarEmailStatusPedido("o1", "REFUNDED")).resolves.toBeNull();
    expect(prismaMock.emailOutbox.create).not.toHaveBeenCalled();
  });

  it("corrida/reprocesso (P2002) → devolve o id da linha já existente", async () => {
    prismaMock.emailOutbox.create.mockRejectedValue({ code: "P2002" });
    prismaMock.emailOutbox.findUnique.mockResolvedValue({ id: "row-old" });

    await expect(enfileirarEmailStatusPedido("o1", "REFUNDED")).resolves.toBe("row-old");
    expect(prismaMock.emailOutbox.findUnique).toHaveBeenCalledWith({
      where: { dedupeKey: "status:o1:REFUNDED" },
    });
  });

  it("erros de banco que não são P2002 são propagados", async () => {
    prismaMock.emailOutbox.create.mockRejectedValue(new Error("boom"));
    await expect(enfileirarEmailStatusPedido("o1", "REFUNDED")).rejects.toThrow("boom");
  });
});

describe("enfileirarEmail (caminhos que antes enviavam direto: pedido pago, avaliação)", () => {
  it("grava PENDING arbitrário com dedupeKey e payload informado", async () => {
    prismaMock.emailOutbox.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "row-x",
      ...data,
    }));
    const id = await enfileirarEmail({
      dedupeKey: "status:o1:PAID",
      kind: "order_paid",
      orderId: "o1",
      mail: { to: "c@x.com", subject: "Pago", text: "corpo" },
    });
    expect(id).toBe("row-x");
    expect(prismaMock.emailOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dedupeKey: "status:o1:PAID",
          kind: "order_paid",
          status: "PENDING",
          recipient: "c@x.com",
        }),
      })
    );
  });

  it("dedupeKey repetida (P2002) → devolve a linha existente, sem 2º registro", async () => {
    prismaMock.emailOutbox.create.mockRejectedValue(
      Object.assign(new Error("dup"), { code: "P2002" })
    );
    prismaMock.emailOutbox.findUnique.mockResolvedValue({ id: "row-prev" });
    const id = await enfileirarEmail({
      dedupeKey: "review:o1",
      kind: "review_invite",
      mail: { to: "c@x.com", subject: "Avalie", text: "x" },
    });
    expect(id).toBe("row-prev");
    expect(prismaMock.emailOutbox.findUnique).toHaveBeenCalledWith({
      where: { dedupeKey: "review:o1" },
    });
  });

  it("sem destinatário ou assunto → null (não grava)", async () => {
    expect(
      await enfileirarEmail({ dedupeKey: "k", kind: "x", mail: { to: "", subject: "s" } })
    ).toBeNull();
    expect(prismaMock.emailOutbox.create).not.toHaveBeenCalled();
  });
});

describe("processarEmailOutbox", () => {
  it("aceite do provedor → SENT com sentAt e Idempotency-Key = dedupeKey", async () => {
    prismaMock.emailOutbox.findUnique.mockResolvedValue(rowFake());

    const r = await processarEmailOutbox("row-1");

    expect(r).toBe("ENVIADO");
    expect(sendMock).toHaveBeenCalledWith({
      to: "cliente@x.com",
      subject: "Pedido DC-1 — Estornado",
      text: "corpo texto",
      html: "<p>corpo</p>",
      idempotencyKey: "status:o1:REFUNDED",
    });
    expect(prismaMock.emailOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: "row-1", status: "PENDING" },
      data: { status: "SENT", sentAt: expect.any(Date), lastError: null },
    });
  });

  it("falha transitória → fica PENDING com backoff (2min na 1ª retentativa)", async () => {
    prismaMock.emailOutbox.findUnique.mockResolvedValue(rowFake());
    sendMock.mockRejectedValue(new Error("HTTP 500"));

    const antes = Date.now();
    const r = await processarEmailOutbox("row-1");

    expect(r).toBe("RETENTAR");
    const data = prismaMock.emailOutbox.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("PENDING");
    expect(data.attempt).toBe(1);
    expect(data.lastError).toContain("HTTP 500");
    expect(data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(antes + 2 * 60_000);
    expect(data.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 2 * 60_000 + 5_000);
  });

  it("falha definitiva (configuração/validação) → FAILED na 1ª tentativa", async () => {
    prismaMock.emailOutbox.findUnique.mockResolvedValue(rowFake());
    sendMock.mockRejectedValue(new EmailNaoAceito("Resend não configurado", false));

    const r = await processarEmailOutbox("row-1");

    expect(r).toBe("FALHOU");
    const data = prismaMock.emailOutbox.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("FAILED");
    expect(data.attempt).toBe(1);
  });

  it(`esgotar ${EMAIL_OUTBOX_MAX_TENTATIVAS} tentativas → FAILED`, async () => {
    prismaMock.emailOutbox.findUnique.mockResolvedValue(
      rowFake({ attempt: EMAIL_OUTBOX_MAX_TENTATIVAS - 1 })
    );
    sendMock.mockRejectedValue(new EmailNaoAceito("HTTP 429", true));

    const r = await processarEmailOutbox("row-1");

    expect(r).toBe("FALHOU");
    const data = prismaMock.emailOutbox.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("FAILED");
    expect(data.attempt).toBe(EMAIL_OUTBOX_MAX_TENTATIVAS);
  });

  it("linha já SENT/FAILED ou inexistente → PULADO (sem novo envio)", async () => {
    prismaMock.emailOutbox.findUnique.mockResolvedValueOnce(rowFake({ status: "SENT" }));
    await expect(processarEmailOutbox("row-1")).resolves.toBe("PULADO");

    prismaMock.emailOutbox.findUnique.mockResolvedValueOnce(rowFake({ status: "FAILED" }));
    await expect(processarEmailOutbox("row-1")).resolves.toBe("PULADO");

    prismaMock.emailOutbox.findUnique.mockResolvedValueOnce(null);
    await expect(processarEmailOutbox("nope")).resolves.toBe("PULADO");

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("vencimento futuro → PULADO (backoff respeitado)", async () => {
    prismaMock.emailOutbox.findUnique.mockResolvedValue(
      rowFake({ nextAttemptAt: new Date(Date.now() + 60_000) })
    );
    await expect(processarEmailOutbox("row-1")).resolves.toBe("PULADO");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("corrida perdida (guarda updateMany 0) → PULADO, sem efeito", async () => {
    prismaMock.emailOutbox.findUnique.mockResolvedValue(rowFake());
    prismaMock.emailOutbox.updateMany.mockResolvedValue({ count: 0 });
    await expect(processarEmailOutbox("row-1")).resolves.toBe("PULADO");
  });
});

describe("drenarEmailsOutbox", () => {
  it("drena só PENDING vencidas e reporta enviados/falhas", async () => {
    const linhas = [rowFake({ id: "a" }), rowFake({ id: "b" }), rowFake({ id: "c" })];
    prismaMock.emailOutbox.findMany.mockResolvedValue(linhas);
    prismaMock.emailOutbox.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        linhas.find((l) => l.id === where.id) ?? null
    );
    sendMock
      .mockResolvedValueOnce({ id: "re_1" })
      .mockRejectedValueOnce(new EmailNaoAceito("Resend: validação", false))
      .mockRejectedValueOnce(new Error("rede"));

    const r = await drenarEmailsOutbox();

    expect(prismaMock.emailOutbox.findMany).toHaveBeenCalledWith({
      where: { status: "PENDING", nextAttemptAt: { lte: expect.any(Date) } },
      orderBy: { nextAttemptAt: "asc" },
      take: 50,
    });
    expect(r).toEqual({ processados: 3, enviados: 1, falhas: 1 });
  });

  it("fila vazia → nada processado", async () => {
    prismaMock.emailOutbox.findMany.mockResolvedValue([]);
    await expect(drenarEmailsOutbox()).resolves.toEqual({
      processados: 0,
      enviados: 0,
      falhas: 0,
    });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
