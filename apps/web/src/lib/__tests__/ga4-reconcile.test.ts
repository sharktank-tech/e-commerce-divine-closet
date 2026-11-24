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
});
