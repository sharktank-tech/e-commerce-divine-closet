import { beforeEach, describe, expect, it, vi } from "vitest";

// Rota PATCH /api/admin/pedidos/[id]: a notificação de status entra no
// OUTBOX na MESMA transação da atualização — nunca envio direto. Combinado
// com a dedupeKey status:{orderId}:{status}, o caminho admin e o caminho
// estorno (webhook) não duplicam e-mail: os dois gravam/apontam para a MESMA
// linha.
// A rota também expõe uma MÁQUINA DE ESTADOS: não aceita regressão de fase e
// recusa REFUNDED manual (estorno é o /estornar, que cria a linha Refund 1:1).
const { prismaMock, requireAuthMock, enfileirarEvento, entregarEvento, enfileirarEmail, processarOutbox } =
  vi.hoisted(() => {
    const prismaMock = {
      order: { findUnique: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(),
    };
    return {
      prismaMock,
      requireAuthMock: vi.fn(),
      enfileirarEvento: vi.fn(),
      entregarEvento: vi.fn(),
      enfileirarEmail: vi.fn(),
      processarOutbox: vi.fn(),
    };
  });

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock, forbidden: () => new Response("forbidden", { status: 403 }) }));
vi.mock("@/lib/erp", () => ({ enfileirarEvento, entregarEvento }));
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
  prismaMock.order.findUnique.mockResolvedValue({
    status: "PAID",
    paymentStatus: "PAID",
    trackingCode: null,
  });
  prismaMock.order.update.mockResolvedValue(orderAtualizado());
  enfileirarEmail.mockResolvedValue("outbox-1");
  processarOutbox.mockResolvedValue("ENVIADO");
  entregarEvento.mockResolvedValue(false);
});

describe("PATCH /api/admin/pedidos/[id] — notificação via outbox", () => {
  it("sem sessão ADMIN → 403 (nunca altera nem notifica)", async () => {
    requireAuthMock.mockResolvedValue(null);
    const res = await PATCH(reqDe({ status: "REFUNDED" }), params);
    expect(res.status).toBe(403);
    expect(prismaMock.order.update).not.toHaveBeenCalled();
    expect(enfileirarEmail).not.toHaveBeenCalled();
  });

  it("REFUNDED manual → 409 (estorno é fluxo próprio) e nada é gravado", async () => {
    // Antes o PATCH aceitava REFUNDED à mão: o pedido ficava "estornado" sem
    // nenhuma linha em `Refund` (que é 1:1 e só nasce com confirmação real do
    // provedor) — auditoria do estorno quebrada. Agora é 409 apontando o
    // endpoint de estorno, e nenhuma escrita acontece.
    const res = await PATCH(reqDe({ status: "REFUNDED" }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("estornar") });
    expect(prismaMock.order.update).not.toHaveBeenCalled();
    expect(enfileirarEmail).not.toHaveBeenCalled();
    expect(enfileirarEvento).not.toHaveBeenCalled();
  });

  it("paymentStatus REFUNDED manual → 409 (só a confirmação do estorno aplica)", async () => {
    const res = await PATCH(reqDe({ status: "PAID", paymentStatus: "REFUNDED" }), params);
    expect(res.status).toBe(409);
    expect(prismaMock.order.update).not.toHaveBeenCalled();
    expect(enfileirarEmail).not.toHaveBeenCalled();
  });

  it("transição inválida (DELIVERED → PENDING) → 409, sem regressão de fase", async () => {
    prismaMock.order.findUnique.mockResolvedValue({ status: "DELIVERED", paymentStatus: "PAID", trackingCode: null });
    const res = await PATCH(reqDe({ status: "PENDING" }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("DELIVERED → PENDING") });
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it("REFUNDED (via estorno) → linha do outbox na MESMA transação + envio pós-commit", async () => {
    // O fluxo de estorno seta o pedido a REFUNDED no banco e a notificação
    // sai pelo MESMO caminho de status — aqui prova o anti-duplicado: o admin
    // não precisa (nem pode) repetir a transição à mão.
    prismaMock.order.findUnique.mockResolvedValue({ status: "PAID", paymentStatus: "PAID", trackingCode: null });
    // PATCH para SHIPPED a partir de PAID: transição legal, notificação de status
    prismaMock.order.update.mockResolvedValue(orderAtualizado({ status: "SHIPPED" }));
    const res = await PATCH(reqDe({ status: "SHIPPED", trackingCode: "BR123" }), params);
    expect(res.status).toBe(200);
    expect(enfileirarEmail).toHaveBeenCalledWith("o1", "SHIPPED", prismaMock);
    await new Promise((r) => setTimeout(r, 0));
    expect(processarOutbox).toHaveBeenCalledWith("outbox-1");
    expect(entregarEvento).not.toHaveBeenCalled();
  });

  it("sem mudança de status → nada enfileirado (anti-duplicado)", async () => {
    prismaMock.order.findUnique.mockResolvedValue({ status: "SHIPPED", paymentStatus: "PAID", trackingCode: "BR123" });
    prismaMock.order.update.mockResolvedValue(orderAtualizado({ status: "SHIPPED" }));
    const res = await PATCH(reqDe({ status: "SHIPPED" }), params);
    expect(res.status).toBe(200);
    expect(enfileirarEmail).not.toHaveBeenCalled();
    expect(processarOutbox).not.toHaveBeenCalled();
  });

  it("CANCELLED → evento ERP + e-mail juntos na transação", async () => {
    prismaMock.order.findUnique.mockResolvedValue({ status: "PAID", paymentStatus: "PAID", trackingCode: null });
    prismaMock.order.update.mockResolvedValue(orderAtualizado({ status: "CANCELLED" }));
    enfileirarEvento.mockResolvedValue("evt-1");

    const res = await PATCH(reqDe({ status: "CANCELLED" }), params);
    expect(res.status).toBe(200);
    expect(enfileirarEvento).toHaveBeenCalledWith(
      "pedido_cancelado",
      expect.objectContaining({ numero: "DC-1" }),
      expect.objectContaining({ businessKey: "pedido_cancelado:o1", db: prismaMock })
    );
    expect(enfileirarEmail).toHaveBeenCalledWith("o1", "CANCELLED", prismaMock);
    await new Promise((r) => setTimeout(r, 0));
    expect(entregarEvento).toHaveBeenCalledWith("evt-1");
    expect(processarOutbox).toHaveBeenCalledWith("outbox-1");
  });
});
