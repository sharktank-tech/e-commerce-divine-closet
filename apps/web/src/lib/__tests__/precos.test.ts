import { describe, expect, it } from "vitest";
import { discountPercent, hasDiscount } from "../precos";

describe("discountPercent", () => {
  it("calcula o percentual arredondado", () => {
    expect(discountPercent(80, 100)).toBe(20);
    expect(discountPercent(75, 100)).toBe(25);
  });

  it("retorna 0 sem desconto real", () => {
    expect(discountPercent(100, 100)).toBe(0);
    expect(discountPercent(120, 100)).toBe(0);
    expect(discountPercent(100, null)).toBe(0);
    expect(discountPercent(100, undefined)).toBe(0);
    expect(discountPercent(0, 100)).toBe(0);
  });

  it("aceita strings numéricas (Decimal do Prisma)", () => {
    expect(discountPercent("80", "100")).toBe(20);
  });
});

describe("hasDiscount", () => {
  it("só true com promocional menor que o original", () => {
    expect(hasDiscount(80, 100)).toBe(true);
    expect(hasDiscount(100, 100)).toBe(false);
    expect(hasDiscount(100, null)).toBe(false);
  });
});
