import { describe, expect, it } from "vitest";
import { reaisParaCentavosTexto } from "@/lib/moeda-input";

describe("reaisParaCentavosTexto", () => {
  it("vírgula e ponto decimais", () => {
    expect(reaisParaCentavosTexto("10,50")).toBe(1050);
    expect(reaisParaCentavosTexto("10.50")).toBe(1050);
  });

  it("espaços em branco", () => {
    expect(reaisParaCentavosTexto("  7,25  ")).toBe(725);
  });

  it("vazio e texto: 0, nunca NaN", () => {
    expect(reaisParaCentavosTexto("")).toBe(0);
    expect(reaisParaCentavosTexto("abc")).toBe(0);
    expect(Number.isNaN(reaisParaCentavosTexto("abc"))).toBe(false);
  });

  it("negativo: 0, nunca negativo", () => {
    expect(reaisParaCentavosTexto("-5")).toBe(0);
  });

  it("arredonda meio centavo para cima", () => {
    expect(reaisParaCentavosTexto("10,005")).toBe(1001);
  });
});
