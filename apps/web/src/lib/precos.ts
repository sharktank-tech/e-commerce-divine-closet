// Desconto real: comparePrice (original) acima do price (atual).
// Retorna o percentual arredondado (0 = sem desconto).
export function discountPercent(
  price: number | string | null | undefined,
  comparePrice: number | string | null | undefined
): number {
  const p = Number(price);
  const c = comparePrice == null ? NaN : Number(comparePrice);
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(c) || c <= p) return 0;
  return Math.round(((c - p) / c) * 100);
}

export function hasDiscount(
  price: number | string | null | undefined,
  comparePrice: number | string | null | undefined
): boolean {
  return discountPercent(price, comparePrice) > 0;
}
