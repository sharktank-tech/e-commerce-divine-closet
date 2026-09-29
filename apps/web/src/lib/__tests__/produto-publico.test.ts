import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  publicProductCardSelect,
  publicProductDetailSelect,
  toPublicCardProduct,
  toPublicVariations,
} from "../produto-publico";

const COST_KEYS = [
  "lote_id",
  "custo_peca_centavos",
  "custo_embalagem_centavos",
  "custos_extras_centavos",
  "custos_extras_descricao",
  "markup_percentual",
  "preco_sugerido_centavos",
  "precificacao_calculada_em",
];

describe("allow-list pública de produtos", () => {
  it("selects públicos não contêm nenhum campo de custo/margem/lote", () => {
    for (const select of [publicProductCardSelect, publicProductDetailSelect]) {
      for (const key of COST_KEYS) {
        expect(select).not.toHaveProperty(key);
      }
    }
  });

  it("toPublicCardProduct nunca expõe custos, mesmo se a entrada os tiver", () => {
    const entrada = {
      id: "1",
      name: "Vestido",
      slug: "vestido",
      price: 3999,
      comparePrice: 4999,
      images: ["/a.jpg"],
      featured: false,
      stock: 50,
      category: { name: "Vestidos", slug: "vestidos" },
      // simula um registro completo do banco (com custos)
      lote_id: "lote-1",
      custo_peca_centavos: 2000,
      custo_embalagem_centavos: 240,
      markup_percentual: 100,
      preco_sugerido_centavos: 4499,
      precificacao_calculada_em: new Date().toISOString(),
    } as never;
    const out = toPublicCardProduct(entrada);
    const texto = JSON.stringify(out);
    for (const key of COST_KEYS) {
      expect(texto).not.toContain(key);
    }
    expect(out.estadoEstoque).toBe("disponivel");
    expect(out).not.toHaveProperty("stock");
  });

  it("estoque exato só aparece quando baixo; nunca quando alto", () => {
    const alto = toPublicCardProduct({
      id: "1", name: "A", slug: "a", price: 1000, images: [], stock: 63,
    });
    expect(alto.estadoEstoque).toBe("disponivel");
    expect(alto).not.toHaveProperty("stock");

    const baixo = toPublicCardProduct({
      id: "2", name: "B", slug: "b", price: 1000, images: [], stock: 3,
    });
    expect(baixo.estadoEstoque).toBe("baixo");
    expect(baixo.stock).toBe(3);

    const esgotado = toPublicCardProduct({
      id: "3", name: "C", slug: "c", price: 1000, images: [], stock: 0,
    });
    expect(esgotado.estadoEstoque).toBe("esgotado");
  });

  it("variações públicas não expõem estoque alto nem custos", () => {
    const out = toPublicVariations([
      { size: "P", color: "Preta", stock: 80 },
      { size: "M", color: "Preta", stock: 2 },
    ]);
    expect(out[0]).not.toHaveProperty("stock");
    expect(out[0].estado).toBe("disponivel");
    expect(out[1].stock).toBe(2);
    expect(out[1].estado).toBe("baixo");
  });

  it("rota pública /api/produtos não espalha o registro completo", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "app", "api", "produtos", "route.ts"),
      "utf8"
    );
    // proíbe o padrão antigo que vazaria custos: spread do objeto Prisma
    expect(src).not.toMatch(/\.\.\.rest/);
    expect(src).toContain("publicProductCardSelect");
    expect(src).toContain("toPublicCardProduct");
  });

  it("wishlist não retorna o produto completo do banco", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "app", "api", "wishlist", "route.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/items:\s*items\.map\(\(i\)\s*=>\s*i\.product\)/);
    expect(src).toContain("toPublicCardProduct");
  });
});
