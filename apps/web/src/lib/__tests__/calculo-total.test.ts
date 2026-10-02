import { describe, expect, it } from "vitest";
import {
  calcularDescontoCentavos,
  calcularFreteCentavos,
  calcularPedido,
  calcularTotalCentavos,
  centavosParaReais,
} from "@/lib/pedidos/calculo-total";
import { reaisParaCentavos } from "@/lib/carrinho-revalidacao";

const FRETE = { fixed: 20, freeFrom: 300 };

describe("calcularDescontoCentavos", () => {
  it("PERCENT sem dízima: 10% de 3333c = 333c", () => {
    expect(
      calcularDescontoCentavos(3333, { type: "PERCENT", value: 10 })
    ).toEqual({ descontoCentavos: 333, freteGratis: false });
  });

  it("PERCENT com dízima periódica: 33,33% de 10000c = 3333c (determinístico)", () => {
    expect(
      calcularDescontoCentavos(10000, { type: "PERCENT", value: 33.33 })
    ).toEqual({ descontoCentavos: 3333, freteGratis: false });
  });

  it("borda ,005: 10% de 1005c = 101c (half-up, documentado)", () => {
    expect(
      calcularDescontoCentavos(1005, { type: "PERCENT", value: 10 })
    ).toEqual({ descontoCentavos: 101, freteGratis: false });
  });

  it("FIXED limitado ao subtotal", () => {
    expect(
      calcularDescontoCentavos(5000, { type: "FIXED", value: 80 })
    ).toEqual({ descontoCentavos: 5000, freteGratis: false });
    expect(
      calcularDescontoCentavos(5000, { type: "FIXED", value: 30 })
    ).toEqual({ descontoCentavos: 3000, freteGratis: false });
  });

  it("FREE_SHIPPING: desconto 0 + frete grátis", () => {
    expect(
      calcularDescontoCentavos(5000, { type: "FREE_SHIPPING", value: 0 })
    ).toEqual({ descontoCentavos: 0, freteGratis: true });
  });
});

describe("calcularFreteCentavos", () => {
  it("abaixo do mínimo: frete fixo", () => {
    expect(calcularFreteCentavos(29999, false, FRETE)).toBe(2000);
  });

  it("no mínimo (inclusive): grátis", () => {
    expect(calcularFreteCentavos(30000, false, FRETE)).toBe(0);
  });

  it("cupom de frete grátis zera mesmo abaixo do mínimo", () => {
    expect(calcularFreteCentavos(1000, true, FRETE)).toBe(0);
  });
});

describe("calcularTotalCentavos", () => {
  it("total nunca negativo", () => {
    expect(calcularTotalCentavos(5000, 8000, 0)).toBe(0);
  });

  it("soma frete após abater desconto", () => {
    expect(calcularTotalCentavos(3333, 333, 2000)).toBe(5000);
  });
});

describe("calcularPedido (pipeline)", () => {
  it("caso da homologação: 33,33 + 10% + frete = 5000c", () => {
    const r = calcularPedido(3333, { type: "PERCENT", value: 10 }, FRETE);
    expect(r).toEqual({
      descontoCentavos: 333,
      freteGratis: false,
      freteCentavos: 2000,
      totalCentavos: 5000,
    });
    expect(centavosParaReais(r.totalCentavos)).toBe(50);
  });

  it("sem cupom: sem desconto, frete pela faixa", () => {
    const r = calcularPedido(30000, null, FRETE);
    expect(r.descontoCentavos).toBe(0);
    expect(r.freteCentavos).toBe(0);
    expect(r.totalCentavos).toBe(30000);
  });

  it("FIXED + frete grátis por valor combinados", () => {
    const r = calcularPedido(35000, { type: "FIXED", value: 30 }, FRETE);
    expect(r).toEqual({
      descontoCentavos: 3000,
      freteGratis: false,
      freteCentavos: 0,
      totalCentavos: 32000,
    });
  });

  it("sem cupom abaixo do limiar: frete fixo (caminho sem desconto)", () => {
    const r = calcularPedido(29999, null, FRETE);
    expect(r).toEqual({
      descontoCentavos: 0,
      freteGratis: false,
      freteCentavos: 2000,
      totalCentavos: 31999,
    });
  });

  it("limiares como chegam da rota (reais → centavos): 299,99 paga frete, 300,00 não", () => {
    const abaixo = calcularPedido(reaisParaCentavos(299.99), null, FRETE);
    expect(abaixo.freteCentavos).toBe(2000);
    expect(abaixo.totalCentavos).toBe(31999);
    const noLimiar = calcularPedido(reaisParaCentavos(300.0), null, FRETE);
    expect(noLimiar.freteCentavos).toBe(0);
    expect(noLimiar.totalCentavos).toBe(30000);
  });

  it("PERCENT aceita valor como string ou Decimal-like", () => {
    expect(
      calcularDescontoCentavos(10000, { type: "PERCENT", value: "10" })
    ).toEqual({ descontoCentavos: 1000, freteGratis: false });
    expect(
      calcularDescontoCentavos(10000, { type: "PERCENT", value: { toString: () => "10" } })
    ).toEqual({ descontoCentavos: 1000, freteGratis: false });
  });
});
