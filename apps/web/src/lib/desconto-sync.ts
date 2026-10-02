import { discountPercent } from "./precos";

// discountPercent gravado é DERIVADO — serve só para filtro/ordenação rápida
// (Ofertas, sort por desconto). Fonte de verdade: price + comparePrice.
//
// Esta função é aplicada pelo hook do client Prisma (lib/prisma.ts) em TODA
// escrita de Product (create/update/upsert/createMany), qualquer que seja a
// origem: formulário admin, import CSV, recálculo em massa, seed ou script.
// Leituras (vitrine, Ofertas, filtros) continuam lendo o campo gravado,
// agora com garantia de sincronismo em vez de sincronismo manual por rota.

export type PrecoEscrita = {
  price?: unknown;
  comparePrice?: unknown;
  discountPercent?: unknown;
};

// Devolve `data` com discountPercent recalculado quando price/comparePrice
// foram tocados. `atual` = valores já gravados (para updates parciais que
// informam só um dos dois). Se nenhum dos dois foi tocado, devolve intacto.
// Assume atribuição escalar (o código só usa set direto em price/comparePrice).
export function comDescontoDerivado<T extends object>(
  data: T,
  atual: { price?: unknown; comparePrice?: unknown } | null = null
): T {
  const escrita = data as PrecoEscrita;
  if (escrita.price === undefined && escrita.comparePrice === undefined) {
    return data;
  }
  const price = escrita.price !== undefined ? escrita.price : atual?.price;
  if (price === undefined || price === null) return data;
  const compare =
    escrita.comparePrice !== undefined
      ? escrita.comparePrice
      : (atual?.comparePrice ?? null);
  return {
    ...data,
    discountPercent: discountPercent(
      price as number | string,
      compare as number | string | null
    ),
  } as T;
}
