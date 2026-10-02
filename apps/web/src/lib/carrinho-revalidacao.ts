// Revalidação de item do carrinho no checkout.
//
// O preço NÃO é travado na cobrança: o pedido usa o preço atual do produto.
// Esta função decide, por item, se algo mudou entre a adição ao carrinho
// (snapshot unitPrice) e o checkout — e o cliente resolve antes de pagar
// (aceitar o novo preço ou remover o item), nunca com troca silenciosa.

export type AvisoItem =
  | { tipo: "preco"; deCentavos: number; paraCentavos: number }
  | { tipo: "indisponivel" }
  | { tipo: "estoque" };

export function revalidarItem(args: {
  /** snapshot em centavos (null = item legado sem snapshot: sem aviso) */
  unitPriceCentavos: number | null;
  /** preço atual em centavos (null = produto sumiu) */
  precoAtualCentavos: number | null;
  ativo: boolean;
  estoqueSuficiente: boolean;
}): AvisoItem | null {
  if (args.precoAtualCentavos == null || !args.ativo) {
    return { tipo: "indisponivel" };
  }
  if (!args.estoqueSuficiente) {
    return { tipo: "estoque" };
  }
  if (
    args.unitPriceCentavos != null &&
    args.unitPriceCentavos !== args.precoAtualCentavos
  ) {
    return {
      tipo: "preco",
      deCentavos: args.unitPriceCentavos,
      paraCentavos: args.precoAtualCentavos,
    };
  }
  return null;
}

export function reaisParaCentavos(v: unknown): number {
  const n =
    typeof v === "object" && v !== null && "toString" in v
      ? Number(String(v))
      : Number(v);
  return Math.round(n * 100);
}
