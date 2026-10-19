import { beforeEach, describe, expect, it, vi } from "vitest";

// Rota PATCH /api/admin/pedidos/[id]: a notificação de status (inclusive
// REFUNDED setado à mão) entra no OUTBOX na MESMA transação da atualização —
// nunca envio direto. Combinado com a dedupeKey status:{orderId}:{status}, o
// caminho admin e o caminho estorno (webhook) não duplicam e-mail: os dois
// gravam/apontam para a MESMA linha.
const { prismaMock, requireAuthMock, enfileirarEmail, processarOutbox } =
  vi.hoisted(() => {
    const prismaMock = {
      order: { findUnique: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(),
    };
    return {
      prismaMock,
      requireAuthMock: vi.fn(),
      enfileirarEmail: vi.fn(),
      processarOutbox: vi.fn(),
    };
  });

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock, forbidden: () => new Response("forbidden", { status: 403 }) }));
vi.mock("@/lib/email-outbox", () => ({
  enfileirarEmailStatusPedido: enfileirarEmail,
  processarEmailOutbox: processarOutbox,
}));

import { PATCH } from "@/app/api/admin/pedidos/[id]/route";

const params = { params: Promise.resolve({ id: "o1" }) };
const reqDe = (body: unknown) => ({ json: async () => body }) as never;

function orderAtualizado(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    number: "DC-1",
    status: "REFUNDED",
    paymentStatus: "PAID",
    trackingCode: null,
    items: [],
    user: { email: "c@x.com", name: "C" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ sub: "admin-1", role: "ADMIN" });
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock)
  );
  prismaMock.order.findUnique.mockResolvedValue({ status: "PAID", trackingCode: null });
  prismaMock.order.update.mockResolvedValue(orderAtualizado());
  enfileirarEmail.mockResolvedValue("outbox-1");
  processarOutbox.mockResolvedValue("ENVIADO");
});

describe("PATCH /api/admin/pedidos/[id] — notificação via outbox", () => {
  it("sem sessão ADMIN → 403 (nunca altera nem notifica)", async () => {
    requireAuthMock.mockResolvedValue(null);
    const res = await PATCH(reqDe({ status: "REFUNDED" }), params);
    expect(res.status).toBe(403);
    expect(prismaMock.order.update).not.toHaveBeenCalled();
    expect(enfileirarEmail).not.toHaveBeenCalled();
  });

  it("REFUNDED → linha do outbox na MESMA transação + envio pós-commit", async () => {
    const res = await PATCH(reqDe({ status: "REFUNDED" }), params);
    expect(res.status).toBe(200);
    // terceiro argumento é o tx da $transaction (atomicidade com a transição)
    expect(enfileirarEmail).toHaveBeenCalledWith("o1", "REFUNDED", prismaMock);
    await new Promise((r) => setTimeout(r, 0));
    expect(processarOutbox).toHaveBeenCalledWith("outbox-1");
  });

  it("sem mudança de status → nada enfileirado (anti-duplicado)", async () => {
    prismaMock.order.findUnique.mockResolvedValue({ status: "REFUNDED", trackingCode: null });
    prismaMock.order.update.mockResolvedValue(orderAtualizado({ status: "REFUNDED" }));
    const res = await PATCH(reqDe({ status: "REFUNDED" }), params);
    expect(res.status).toBe(200);
    expect(enfileirarEmail).not.toHaveBeenCalled();
    expect(processarOutbox).not.toHaveBeenCalled();
  });

  it("CANCELLED → e-mail na MESMA transação (evento ERP: escopo do #11)", async () => {
    prismaMock.order.findUnique.mockResolvedValue({ status: "PAID", trackingCode: null });
    prismaMock.order.update.mockResolvedValue(orderAtualizado({ status: "CANCELLED" }));

    const res = await PATCH(reqDe({ status: "CANCELLED" }), params);
    expect(res.status).toBe(200);
    expect(enfileirarEmail).toHaveBeenCalledWith("o1", "CANCELLED", prismaMock);
    await new Promise((r) => setTimeout(r, 0));
    expect(processarOutbox).toHaveBeenCalledWith("outbox-1");
  });
});
