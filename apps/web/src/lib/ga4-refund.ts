/**
 * GA4 refund: contrato financeiro puro, sem chamadas de rede.
 * O payload só deve ser utilizado depois de estorno APPROVED e consentimento
 * persistido/verificável; esta função NÃO autoriza nem envia analytics.
 */
export type RefundItemSnapshot = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
};
export type ConfirmedRefundSnapshot = {
  orderId: string;
  approved: boolean;
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  items: RefundItemSnapshot[];
};
export type Ga4RefundEvent = {
  name: "refund";
  params: {
    transaction_id: string;
    currency: "BRL";
    value: number;
    shipping: number;
    items: Array<{
      item_id: string;
      item_name: string;
      price: number;
      quantity: number;
    }>;
  };
};

function cents(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`invalid_${label}`);
  const raw = value * 100;
  const rounded = Math.round(raw);
  if (Math.abs(raw - rounded) > 0.000001) throw new Error(`invalid_precision_${label}`);
  return rounded;
}
function money(valueInCents: number): number {
  return valueInCents / 100;
}

/**
 * Estorno integral: value representa mercadorias líquidas de desconto;
 * frete fica separado. Rejeita divergência contábil em vez de inventar valor.
 * Os preços dos itens são históricos e podem anteceder desconto de carrinho.
 * Para pedidos com desconto, a lista items é omitida até existir alocação
 * determinística que reconcilie valores por item.
 */
export function buildGa4RefundEvent(snapshot: ConfirmedRefundSnapshot): Ga4RefundEvent {
  if (!snapshot.approved) throw new Error("refund_not_approved");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshot.orderId))
    throw new Error("invalid_transaction_id");

  const subtotal = cents(snapshot.subtotal, "subtotal");
  const discount = cents(snapshot.discount, "discount");
  const shipping = cents(snapshot.shipping, "shipping");
  const total = cents(snapshot.total, "total");
  if (discount > subtotal || subtotal - discount + shipping !== total)
    throw new Error("refund_total_mismatch");

  let itemSubtotal = 0;
  if (!snapshot.items.length) throw new Error("refund_missing_items");
  const items = snapshot.items.map((item) => {
    if (!item.productId || !item.productName || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)
      throw new Error("refund_invalid_item");
    const unitCents = cents(item.unitPrice, "item_price");
    itemSubtotal += unitCents * item.quantity;
    if (!Number.isSafeInteger(itemSubtotal)) throw new Error("refund_item_overflow");
    return {
      item_id: item.productId,
      item_name: item.productName,
      price: money(unitCents),
      quantity: item.quantity,
    };
  });
  if (itemSubtotal !== subtotal) throw new Error("refund_item_subtotal_mismatch");

  return {
    name: "refund",
    params: {
      transaction_id: snapshot.orderId,
      currency: "BRL",
      value: money(subtotal - discount),
      shipping: money(shipping),
      items: discount === 0 ? items : [],
    },
  };
}

/** Deduplicação persistente deve usar UNIQUE no banco; não localStorage. */
export function refundDedupeKey(refundId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refundId))
    throw new Error("invalid_refund_id");
  return `ga4:refund:${refundId.toLowerCase()}`;
}
