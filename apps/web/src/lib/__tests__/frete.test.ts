import { describe, expect, it } from "vitest";
import { calcularFrete, faixaPrazoPorCep } from "@/lib/frete";

const CFG = { fixed: 20, freeFrom: 300 };

describe("faixaPrazoPorCep", () => {
  it("bandas por região (1º dígito)", () => {
    expect(faixaPrazoPorCep("01310100")).toEqual({ min: 3, max: 5 });
    expect(faixaPrazoPorCep("50000000")).toEqual({ min: 5, max: 8 });
    expect(faixaPrazoPorCep("90000000")).toEqual({ min: 7, max: 12 });
  });
});

describe("calcularFrete (fonte única)", () => {
  it("abaixo do mínimo: preço fixo", () => {
    const r = calcularFrete("01310100", 100, null, CFG);
    expect(r).toMatchObject({ precoReais: 20, gratis: false });
  });

  it("acima do mínimo: grátis", () => {
    const r = calcularFrete("01310100", 300, null, CFG);
    expect(r).toMatchObject({ precoReais: 0, gratis: true });
  });

  it("cupom frete-grátis zera mesmo abaixo do mínimo", () => {
    const r = calcularFrete(
      "01310100",
      100,
      { type: "FREE_SHIPPING", value: 0 },
      CFG
    );
    expect(r).toMatchObject({ precoReais: 0, gratis: true });
  });

  it("eta acompanha a região do CEP", () => {
    expect(calcularFrete("90000000", 100, null, CFG).eta).toContain("12 dias");
  });
});
