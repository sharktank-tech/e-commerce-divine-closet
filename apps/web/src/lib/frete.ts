import {
  calcularPedido,
  centavosParaReais,
  type CupomCalculo,
  type FreteConfig,
} from "./pedidos/calculo-total";
import { reaisParaCentavos } from "./carrinho-revalidacao";

// Fonte única do frete (item 6): /api/frete (exibido), /api/cupom e
// /api/pedidos (gravado) usam este pipeline — exibido e cobrado coincidem.

/** Prazo simulado por região do CEP (1º dígito) até transportadora real. */
export function faixaPrazoPorCep(cepDigitos8: string): { min: number; max: number } {
  const d = Number(cepDigitos8[0]);
  if (d <= 3) return { min: 3, max: 5 };
  if (d <= 6) return { min: 5, max: 8 };
  return { min: 7, max: 12 };
}

export type FreteCalculado = {
  precoReais: number;
  gratis: boolean;
  prazo: { min: number; max: number };
  eta: string;
};

export function calcularFrete(
  cepDigitos8: string,
  subtotalReais: number,
  cupom: CupomCalculo | null,
  config: FreteConfig
): FreteCalculado {
  const { freteCentavos, freteGratis } = calcularPedido(
    reaisParaCentavos(subtotalReais),
    cupom,
    config
  );
  const prazo = faixaPrazoPorCep(cepDigitos8);
  return {
    precoReais: centavosParaReais(freteCentavos),
    gratis: freteGratis || freteCentavos === 0,
    prazo,
    eta: `em até ${prazo.max} dias úteis`,
  };
}
