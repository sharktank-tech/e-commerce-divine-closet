import { describe, expect, it } from "vitest";
import { ordenarTamanhos } from "../tamanhos";

describe("ordenarTamanhos", () => {
  it("ordena a escala de letras PP → G3", () => {
    expect(ordenarTamanhos(["M", "GG", "PP", "G", "P", "XG", "G1"])).toEqual([
      "PP",
      "P",
      "M",
      "G",
      "GG",
      "XG",
      "G1",
    ]);
  });

  it("tolera caixa alta/baixa e espaços", () => {
    expect(ordenarTamanhos([" g ", "m", "P"])).toEqual(["P", "m", " g "]);
  });

  it("ordena numéricos de forma crescente", () => {
    expect(ordenarTamanhos(["40", "34", "38", "36"])).toEqual(["34", "36", "38", "40"]);
  });

  it("coloca Único por último", () => {
    expect(ordenarTamanhos(["M", "Único", "P", "38"])).toEqual(["P", "M", "38", "Único"]);
  });

  it("mistura letras, números e desconhecidos com sensatez", () => {
    const out = ordenarTamanhos(["38", "GG", "Único", "P", "XL"]);
    expect(out.slice(0, 2)).toEqual(["P", "GG"]);
    expect(out[out.length - 1]).toBe("Único");
  });

  it("não muta o array original", () => {
    const input = ["G", "P"];
    ordenarTamanhos(input);
    expect(input).toEqual(["G", "P"]);
  });
});
