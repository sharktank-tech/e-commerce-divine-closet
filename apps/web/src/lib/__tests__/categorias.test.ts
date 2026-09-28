import { describe, expect, it } from "vitest";
import {
  buildHomeCategories,
  buildMenu,
  nonEmpty,
  type NavCategory,
} from "../categorias";

function cat(over: Partial<NavCategory> & { slug: string }): NavCategory {
  return {
    id: over.slug,
    name: over.slug,
    image: null,
    menuOrder: 0,
    showInMenu: true,
    showInHome: true,
    availableCount: 1,
    ...over,
  };
}

describe("nonEmpty", () => {
  it("remove categorias sem produto ativo em estoque", () => {
    const cats = [cat({ slug: "a" }), cat({ slug: "b", availableCount: 0 })];
    expect(nonEmpty(cats).map((c) => c.slug)).toEqual(["a"]);
  });
});

describe("buildMenu", () => {
  it("monta Novidades + categorias + Ofertas, sem vazias", () => {
    const menu = buildMenu(
      [
        cat({ slug: "vestidos", name: "Vestidos" }),
        cat({ slug: "saias", name: "Saias", availableCount: 0 }),
      ],
      2
    );
    expect(menu).toEqual([
      { label: "Novidades", href: "/produtos" },
      { label: "Vestidos", href: "/categoria/vestidos" },
      { label: "Ofertas", href: "/ofertas" },
    ]);
  });

  it("oculta Ofertas quando não há desconto real", () => {
    const menu = buildMenu([cat({ slug: "vestidos", name: "Vestidos" })], 0);
    expect(menu.map((m) => m.label)).toEqual(["Novidades", "Vestidos"]);
  });

  it("combina Calças e Shorts em item único quando ambas têm produtos", () => {
    const menu = buildMenu(
      [
        cat({ slug: "blusas", name: "Blusas" }),
        cat({ slug: "calcas", name: "Calças" }),
        cat({ slug: "shorts", name: "Shorts" }),
      ],
      1
    );
    expect(menu).toEqual([
      { label: "Novidades", href: "/produtos" },
      { label: "Blusas", href: "/categoria/blusas" },
      { label: "Calças e Shorts", href: "/produtos?categoria=calcas,shorts" },
      { label: "Ofertas", href: "/ofertas" },
    ]);
  });

  it("mostra individual quando só uma das duas tem produtos", () => {
    const menu = buildMenu(
      [
        cat({ slug: "calcas", name: "Calças" }),
        cat({ slug: "shorts", name: "Shorts", availableCount: 0 }),
      ],
      5
    );
    expect(menu.map((m) => m.label)).toEqual(["Novidades", "Calças", "Ofertas"]);
  });

  it("respeita showInMenu=false e menuOrder", () => {
    const menu = buildMenu(
      [
        cat({ slug: "a", name: "A", menuOrder: 5 }),
        cat({ slug: "b", name: "B", menuOrder: 1 }),
        cat({ slug: "c", name: "C", showInMenu: false }),
      ],
      5
    );
    expect(menu.map((m) => m.label)).toEqual(["Novidades", "B", "A", "Ofertas"]);
  });
});

describe("buildHomeCategories", () => {
  it("filtra showInHome e ordena", () => {
    const cats = buildHomeCategories([
      cat({ slug: "a", name: "A", menuOrder: 2 }),
      cat({ slug: "b", name: "B", menuOrder: 1, showInHome: false }),
      cat({ slug: "c", name: "C", availableCount: 0 }),
    ]);
    expect(cats.map((c) => c.slug)).toEqual(["a"]);
  });
});
