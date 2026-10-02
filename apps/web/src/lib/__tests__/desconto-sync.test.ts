import { describe, expect, it } from "vitest";
import { comDescontoDerivado } from "@/lib/desconto-sync";

describe("comDescontoDerivado", () => {
  it("create com desconto: grava o percentual derivado", () => {
    expect(comDescontoDerivado({ price: 100, comparePrice: 150 })).toMatchObject({
      price: 100,
      comparePrice: 150,
      discountPercent: 33,
    });
  });

  it("create sem comparePrice: grava 0", () => {
    expect(comDescontoDerivado({ price: 100 })).toMatchObject({
      discountPercent: 0,
    });
  });

  it("comparePrice menor ou igual ao preço: grava 0", () => {
    expect(comDescontoDerivado({ price: 100, comparePrice: 80 })).toMatchObject(
      { discountPercent: 0 }
    );
    expect(
      comDescontoDerivado({ price: 100, comparePrice: 100 })
    ).toMatchObject({ discountPercent: 0 });
  });

  it("update só do price: mescla com o compare gravado", () => {
    const out = comDescontoDerivado(
      { price: 90 },
      { price: 100, comparePrice: 150 }
    );
    expect(out).toMatchObject({ discountPercent: 40 });
  });

  it("remoção do desconto (compare → null): zera e some de Ofertas", () => {
    const out = comDescontoDerivado(
      { comparePrice: null },
      { price: 100, comparePrice: 150 }
    );
    expect(out).toMatchObject({ discountPercent: 0 });
  });

  it("update que não toca preço: devolve intacto, sem ler o gravado", () => {
    const data = { stock: 5 };
    expect(comDescontoDerivado(data, { price: 100, comparePrice: 150 })).toBe(
      data
    );
    expect("discountPercent" in comDescontoDerivado(data)).toBe(false);
  });

  it("nunca ressuscita desconto apagado: sem atual e só price → 0", () => {
    expect(comDescontoDerivado({ price: 100 }, null)).toMatchObject({
      discountPercent: 0,
    });
  });
});
