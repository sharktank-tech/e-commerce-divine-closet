// Cálculo de total do pedido — fonte única (item 6).
//
// Usado por /api/cupom (valor exibido no checkout) e /api/pedidos (valor
// gravado). Tudo em centavos inteiros: nenhuma das duas rotas mantém cópia
// própria da fórmula, então exibido e gravado não divergem em centavos.
//
// Regra de arredondamento: half-up (Math.round) no nível do centavo.

import { reaisParaCentavos } from "@/lib/carrinho-revalidacao";

export type TipoCupom = "PERCENT" | "FIXED" | "FREE_SHIPPING";

export type CupomCalculo = {
  type: TipoCupom;
  value: unknown;
};

export type FreteConfig = {
  /** valor fixo do frete em reais */
  fixed: number;
  /** a partir de (reais, inclusive) o frete é grátis */
  freeFrom: number;
};

export type TotalPedido = {
  descontoCentavos: number;
  freteGratis: boolean;
  freteCentavos: number;
  totalCentavos: number;
};

export function calcularDescontoCentavos(
  subtotalCentavos: number,
  cupom: CupomCalculo
): { descontoCentavos: number; freteGratis: boolean } {
  if (cupom.type === "PERCENT") {
    return {
      descontoCentavos: Math.round(
        (subtotalCentavos * Number(String(cupom.value))) / 100
      ),
      freteGratis: false,
    };
  }
  if (cupom.type === "FIXED") {
    return {
      descontoCentavos: Math.min(subtotalCentavos, reaisParaCentavos(cupom.value)),
      freteGratis: false,
    };
  }
  return { descontoCentavos: 0, freteGratis: true };
}

export function calcularFreteCentavos(
  subtotalCentavos: number,
  freteGratis: boolean,
  config: FreteConfig
): number {
  if (freteGratis || subtotalCentavos >= Math.round(config.freeFrom * 100)) {
    return 0;
  }
  return Math.round(config.fixed * 100);
}

export function calcularTotalCentavos(
  subtotalCentavos: number,
  descontoCentavos: number,
  freteCentavos: number
): number {
  return Math.max(0, subtotalCentavos - descontoCentavos) + freteCentavos;
}

/** Pipeline completo: do subtotal (centavos) + cupom validado aos valores finais. */
export function calcularPedido(
  subtotalCentavos: number,
  cupom: CupomCalculo | null,
  frete: FreteConfig
): TotalPedido {
  const { descontoCentavos, freteGratis } = cupom
    ? calcularDescontoCentavos(subtotalCentavos, cupom)
    : { descontoCentavos: 0, freteGratis: false };
  const freteCentavos = calcularFreteCentavos(subtotalCentavos, freteGratis, frete);
  return {
    descontoCentavos,
    freteGratis,
    freteCentavos,
    totalCentavos: calcularTotalCentavos(subtotalCentavos, descontoCentavos, freteCentavos),
  };
}

/** centavos → reais com 2 casas (para resposta da API e gravação). */
export function centavosParaReais(centavos: number): number {
  return Math.round(centavos) / 100;
}
