// Escolha do carrinho no checkout: o cliente pode ter carrinho de
// convidado (cookie) E de usuário (login) ao mesmo tempo. Sem preferência,
// o findFirst podia devolver o vazio ("Carrinho vazio" com item na tela).
export type CarrinhoCandidato<TItem = unknown> = {
  id: string;
  items: TItem[];
};

export function escolherCarrinho<T extends CarrinhoCandidato>(
  carts: T[]
): T | null {
  if (carts.length === 0) return null;
  return carts.find((c) => c.items.length > 0) ?? carts[0];
}
