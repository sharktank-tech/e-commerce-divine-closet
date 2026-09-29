import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  buildCategoryDescription,
  buildCategoryTitle,
  buildProductDescription,
  buildProductTitle,
  truncate,
} from "../seo";

describe("truncate", () => {
  it("mantém textos curtos", () => {
    expect(truncate("abc", 10)).toBe("abc");
  });

  it("corta sem quebrar palavra", () => {
    const out = truncate("Vestido midi floral para o verão", 20);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s\S…$/);
  });
});

describe("buildCategoryTitle", () => {
  it("usa feminino plural", () => {
    expect(buildCategoryTitle("Vestidos")).toBe("Vestidos femininos");
  });

  it("trata exceção gramatical", () => {
    expect(buildCategoryTitle("Moda Praia")).toBe("Moda Praia feminina");
  });
});

describe("buildProductTitle", () => {
  it("compõe nome + cor + categoria", () => {
    expect(buildProductTitle("Vestido Pietra", "Azul", "Vestidos")).toBe(
      "Vestido Pietra Azul | Vestidos"
    );
  });

  it("omite partes vazias", () => {
    expect(buildProductTitle("Blusa", null, null)).toBe("Blusa");
  });
});

describe("buildProductDescription", () => {
  it("prioriza meta description", () => {
    expect(buildProductDescription("Meta curta", "Descrição longa".repeat(50))).toBe(
      "Meta curta"
    );
  });

  it("cai para os primeiros ~150 da descrição", () => {
    const out = buildProductDescription(null, "x".repeat(500));
    expect(out.length).toBeLessThanOrEqual(151);
  });

  it("nunca retorna vazio quebrado", () => {
    expect(buildProductDescription(null, null)).toBe("");
  });
});

describe("absoluteUrl", () => {
  it("resolve relativas e preserva absolutas", () => {
    expect(absoluteUrl("/a.png")).toMatch(/^https?:\/\/.+\/a\.png$/);
    expect(absoluteUrl("https://x.com/a.png")).toBe("https://x.com/a.png");
  });
});

describe("buildCategoryDescription", () => {
  it("menciona entrega e troca", () => {
    const d = buildCategoryDescription("Vestidos");
    expect(d).toMatch(/Vestidos/);
    expect(d.length).toBeLessThanOrEqual(160);
  });
});
