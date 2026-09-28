import { describe, expect, it } from "vitest";
import { complementosPara, pushRecent, COMPLEMENTOS } from "../recomendacoes";

describe("complementosPara", () => {
  it("retorna categorias complemento conhecidas", () => {
    expect(complementosPara("vestidos")).toContain("jaquetas-e-casacos");
    expect(complementosPara("blusas")).toEqual(["calcas", "saias", "shorts"]);
  });

  it("desconhecida retorna vazio", () => {
    expect(complementosPara("inexistente")).toEqual([]);
  });

  it("só referencia categorias do mapa", () => {
    const slugs = new Set(Object.keys(COMPLEMENTOS));
    for (const list of Object.values(COMPLEMENTOS)) {
      for (const s of list) {
        if (!["acessorios"].includes(s)) expect(slugs.has(s)).toBe(true);
      }
    }
  });
});

describe("pushRecent", () => {
  it("move para o frente sem repetir e respeita o teto", () => {
    expect(pushRecent(["a", "b"], "c", 12)).toEqual(["c", "a", "b"]);
    expect(pushRecent(["a", "b"], "a", 12)).toEqual(["a", "b"]);
    expect(pushRecent(["a", "b"], "c", 2)).toEqual(["c", "a"]);
  });
});
