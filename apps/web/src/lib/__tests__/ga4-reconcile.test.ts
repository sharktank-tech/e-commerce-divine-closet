import { describe, expect, it, vi, beforeEach } from "vitest";

const { orderFindMany, enqueueMock } = vi.hoisted(() => ({
  orderFindMany: vi.fn(),
  enqueueMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findMany: orderFindMany },
  },
}));

vi.mock("@/lib/ga4-refund-outbox", () => ({
  enqueueGa4RefundIfAuthorized: enqueueMock,
}));

import { reconcileGa4RefundIntents } from "../ga4-refund-reconcile";

describe("GA4 reconciliação de intenções ausentes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("enfileira intenção ausente para pedido estornado", async () => {
    orderFindMany.mockResolvedValue([{ id: "order-1" }, { id: "order-2" }]);
    enqueueMock.mockResolvedValue("CREATED");
    const result = await reconcileGa4RefundIntents(10);
    expect(result.checked).toBe(2);
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("conta already_exists sem erro", async () => {
    orderFindMany.mockResolvedValue([{ id: "order-1" }]);
    enqueueMock.mockResolvedValue("ALREADY_EXISTS");
    const result = await reconcileGa4RefundIntents(10);
    expect(result.checked).toBe(1);
    expect(result.alreadyExists).toBe(1);
    expect(result.created).toBe(0);
  });

  it("conta skipped", async () => {
    orderFindMany.mockResolvedValue([{ id: "order-1" }]);
    enqueueMock.mockResolvedValue("SKIPPED");
    const result = await reconcileGa4RefundIntents(10);
    expect(result.skipped).toBe(1);
  });

  it("conta erros sem interromper", async () => {
    orderFindMany.mockResolvedValue([{ id: "order-1" }, { id: "order-2" }]);
    enqueueMock.mockRejectedValueOnce(new Error("db error"));
    enqueueMock.mockResolvedValueOnce("CREATED");
    const result = await reconcileGa4RefundIntents(10);
    expect(result.errors).toBe(1);
    expect(result.created).toBe(1);
  });

  it("retorna vazio quando não há pedidos", async () => {
    orderFindMany.mockResolvedValue([]);
    const result = await reconcileGa4RefundIntents(10);
    expect(result.checked).toBe(0);
    expect(result.created).toBe(0);
  });
  it("limita a rodada e retorna cursor quando há mais pedidos", async () => {
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    orderFindMany.mockResolvedValue(ids.map((id) => ({ id })));
    enqueueMock.mockResolvedValue("SKIPPED");
    const result = await reconcileGa4RefundIntents(2);
    expect(result.checked).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.nextCursor).toBe(ids[1]);
    expect(enqueueMock).toHaveBeenCalledTimes(2);
    expect(enqueueMock).not.toHaveBeenCalledWith(ids[2]);
    expect(orderFindMany).toHaveBeenCalledWith({
      where: { paymentStatus: "REFUNDED", refund: { status: "APPROVED" } },
      orderBy: { id: "asc" },
      select: { id: true },
      take: 3,
    });
  });

  it("busca lote seguinte com id maior que cursor, sem pular pedidos", async () => {
    const cursor = "22222222-2222-4222-8222-222222222222";
    const id = "33333333-3333-4333-8333-333333333333";
    orderFindMany.mockResolvedValue([{ id }]);
    enqueueMock.mockResolvedValue("CREATED");
    const result = await reconcileGa4RefundIntents(2, cursor);
    expect(result.created).toBe(1);
    expect(result.checked).toBe(1);
    expect(result.nextCursor).toBeNull();
    expect(orderFindMany).toHaveBeenCalledWith({
      where: {
        paymentStatus: "REFUNDED",
        refund: { status: "APPROVED" },
        id: { gt: cursor },
      },
      orderBy: { id: "asc" },
      select: { id: true },
      take: 3,
    });
  });

  it("rejeita limites inválidos antes de consultar o banco", async () => {
    for (const limit of [0, -1, 1.2, 101, NaN, Infinity]) {
      await expect(reconcileGa4RefundIntents(limit)).rejects.toThrow("invalid_reconciliation_limit");
    }
    expect(orderFindMany).not.toHaveBeenCalled();
  });

  it("rejeita cursor inválido, sem fazer consultas", async () => {
    await expect(reconcileGa4RefundIntents(10, "not-a-uuid")).rejects.toThrow("invalid_reconciliation_cursor");
    expect(orderFindMany).not.toHaveBeenCalled();
  });

});
