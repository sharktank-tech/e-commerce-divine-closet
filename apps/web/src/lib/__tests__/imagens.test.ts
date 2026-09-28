import { describe, expect, it } from "vitest";
import { describeAlt, findColorIndex, normalizeImageMeta } from "../imagens";

describe("normalizeImageMeta", () => {
  it("alinha arrays ao tamanho de images", () => {
    expect(normalizeImageMeta(["a", "b", "c"], ["x"], null)).toEqual({
      colors: ["x", "", ""],
      alts: ["", "", ""],
    });
  });

  it("trunca excedentes", () => {
    expect(normalizeImageMeta(["a"], ["x", "y"], ["1", "2"])).toEqual({
      colors: ["x"],
      alts: ["1"],
    });
  });
});

describe("findColorIndex", () => {
  it("acha a primeira imagem da cor (case-insensitive)", () => {
    expect(findColorIndex(["", "Azul", "azul"], "AZUL")).toBe(1);
  });

  it("retorna -1 sem correspondência ou cor vazia", () => {
    expect(findColorIndex(["Azul"], "Verde")).toBe(-1);
    expect(findColorIndex(["Azul"], "")).toBe(-1);
  });
});

describe("describeAlt", () => {
  it("gera o padrão com cor e vista", () => {
    expect(describeAlt("Vestido Pietra", 0, "Azul", null)).toBe(
      "Vestido Pietra, Azul, vista 1"
    );
  });

  it("omite cor vazia e respeita alt customizado", () => {
    expect(describeAlt("Vestido Pietra", 2, "", null)).toBe("Vestido Pietra, vista 3");
    expect(describeAlt("Vestido", 0, "Azul", "  Detalhe do decote  ")).toBe(
      "Detalhe do decote"
    );
  });
});
