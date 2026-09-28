// Agregados e elegibilidade de avaliações (lógica pura, testável).

export type ReviewRow = {
  rating: number;
  caimento?: string | null;
  fotos?: unknown;
};

export type ReviewSummary = {
  total: number;
  media: number;
  dist: Record<1 | 2 | 3 | 4 | 5, number>;
  caimento: { pequeno: number; ideal: number; grande: number };
  comFoto: number;
};

export function summarizeReviews(rows: ReviewRow[]): ReviewSummary {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  const caimento = { pequeno: 0, ideal: 0, grande: 0 };
  let soma = 0;
  let comFoto = 0;

  for (const r of rows) {
    const nota = Math.min(5, Math.max(1, Math.round(r.rating)));
    dist[nota as 1 | 2 | 3 | 4 | 5]++;
    soma += r.rating;
    const c = (r.caimento || "").toLowerCase();
    if (c === "pequeno" || c === "ideal" || c === "grande") caimento[c]++;
    const fotos = Array.isArray(r.fotos) ? r.fotos : [];
    if (fotos.length > 0) comFoto++;
  }

  return {
    total: rows.length,
    media: rows.length === 0 ? 0 : Math.round((soma / rows.length) * 10) / 10,
    dist,
    caimento,
    comFoto,
  };
}

export type OrderRef = {
  id: string;
  userId?: string | null;
  status: string;
  paymentStatus: string;
  productIds: string[];
};

/** pedido do usuário, pago ou entregue, contendo o produto */
export function findEligibleOrder(
  orders: OrderRef[],
  userId: string,
  productId: string
): OrderRef | null {
  return (
    orders.find(
      (o) =>
        o.userId === userId &&
        o.productIds.includes(productId) &&
        (o.paymentStatus === "PAID" || o.status === "DELIVERED")
    ) || null
  );
}
