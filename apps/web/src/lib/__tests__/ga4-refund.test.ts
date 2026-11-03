import { describe, expect, it } from "vitest";
import { buildGa4RefundEvent, refundDedupeKey, type ConfirmedRefundSnapshot } from "../ga4-refund";

const ID = "6fda65c2-7a90-4f18-88e8-1878f5a4c5de";
const base: ConfirmedRefundSnapshot = {
  orderId: ID,
  approved: true,
  subtotal: 100,
  discount: 0,
  shipping: 12,
  total: 112,
  items: [{ productId: "p1", productName: "Vestido", quantity: 2, unitPrice: 50 }],
};

describe("GA4 refund — contrato financeiro sem I/O", () => {
  it("emite payload de estorno aprovado usando o UUID original e BRL", () => {
    expect(buildGa4RefundEvent(base)).toEqual({
      name: "refund",
      params: {
        transaction_id: ID,
        currency: "BRL",
        value: 100,
        shipping: 12,
        items: [{ item_id: "p1", item_name: "Vestido", quantity: 2, price: 50 }],
      },
    });
  });
  it("não inclui frete em value", () => {
    expect(buildGa4RefundEvent(base).params.value).toBe(100);
  });
  it("usa valor líquido dos itens e não inventa alocação de descontos", () => {
    const result = buildGa4RefundEvent({ ...base, discount: 10, total: 102 });
    expect(result.params.value).toBe(90);
    expect(result.params.items).toEqual([]);
  });
  it("rejeita estorno ainda não confirmado", () => {
    expect(() => buildGa4RefundEvent({ ...base, approved: false })).toThrow("refund_not_approved");
  });
  it("rejeita divergência entre total e componentes", () => {
    expect(() => buildGa4RefundEvent({ ...base, total: 113 })).toThrow("refund_total_mismatch");
  });
  it("rejeita divergência do snapshot de produtos", () => {
    expect(() => buildGa4RefundEvent({ ...base, items: [{ ...base.items[0], quantity: 1 }] }))
      .toThrow("refund_item_subtotal_mismatch");
  });
  it("rejeita precisão monetária inválida", () => {
    expect(() => buildGa4RefundEvent({ ...base, shipping: 12.001 })).toThrow("invalid_precision_shipping");
  });
  it("gera chave estável vinculada ao reembolso e não ao navegador", () => {
    expect(refundDedupeKey(ID)).toBe(`ga4:refund:${ID}`);
  });
});
