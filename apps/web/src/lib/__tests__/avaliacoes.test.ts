import { describe, expect, it } from "vitest";
import { findEligibleOrder, summarizeReviews } from "../avaliacoes";

describe("summarizeReviews", () => {
  it("calcula média, distribuição e caimento", () => {
    const s = summarizeReviews([
      { rating: 5, caimento: "ideal", fotos: ["a"] },
      { rating: 4, caimento: "pequeno", fotos: [] },
      { rating: 5, caimento: null, fotos: null },
    ]);
    expect(s.total).toBe(3);
    expect(s.media).toBe(4.7);
    expect(s.dist[5]).toBe(2);
    expect(s.dist[4]).toBe(1);
    expect(s.caimento).toEqual({ pequeno: 1, ideal: 1, grande: 0 });
    expect(s.comFoto).toBe(1);
  });

  it("vazio zera tudo", () => {
    expect(summarizeReviews([])).toEqual({
      total: 0,
      media: 0,
      dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      caimento: { pequeno: 0, ideal: 0, grande: 0 },
      comFoto: 0,
    });
  });
});

describe("findEligibleOrder", () => {
  const orders = [
    { id: "o1", userId: "u1", status: "PENDING", paymentStatus: "PENDING", productIds: ["p1"] },
    { id: "o2", userId: "u1", status: "PROCESSING", paymentStatus: "PAID", productIds: ["p1"] },
    { id: "o3", userId: "u2", status: "DELIVERED", paymentStatus: "PAID", productIds: ["p1"] },
  ];

  it("acha pedido pago/entregue do usuário com o produto", () => {
    expect(findEligibleOrder(orders, "u1", "p1")?.id).toBe("o2");
    expect(findEligibleOrder(orders, "u2", "p1")?.id).toBe("o3");
  });

  it("rejeita sem compra válida", () => {
    expect(findEligibleOrder(orders, "u1", "p9")).toBeNull();
    expect(findEligibleOrder(orders, "u9", "p1")).toBeNull();
  });
});
