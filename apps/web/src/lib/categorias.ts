// Fonte única da navegação por categorias (Tarefa 3).
// Menu do header, "Compre por categoria" da home, filtros e rodapé
// consomem estes builders sobre os mesmos dados do banco.

export type NavCategory = {
  id: string;
  name: string;
  slug: string;
  image?: string | null;
  menuOrder: number;
  showInMenu: boolean;
  showInHome: boolean;
  /** produtos ativos com estoque (>0) */
  availableCount: number;
};

export type MenuItem = { label: string; href: string };

function byOrder(a: NavCategory, b: NavCategory): number {
  return a.menuOrder - b.menuOrder || a.name.localeCompare(b.name, "pt-BR");
}

/** Categorias com ao menos 1 produto ativo em estoque. */
export function nonEmpty(cats: NavCategory[]): NavCategory[] {
  return cats.filter((c) => c.availableCount > 0);
}

/**
 * Menu principal: Novidades + categorias (showInMenu) + Ofertas.
 * "Calças e Shorts" aparece como item único combinado quando AMBAS têm
 * produtos; se só uma tem, ela aparece individualmente.
 * "Ofertas" só aparece quando há ao menos 1 produto com desconto real.
 */
export function buildMenu(all: NavCategory[], offersCount = 0): MenuItem[] {
  const cats = nonEmpty(all).filter((c) => c.showInMenu);
  const bySlug = new Map(cats.map((c) => [c.slug, c]));
  const hasCalcas = bySlug.has("calcas");
  const hasShorts = bySlug.has("shorts");
  const combo = hasCalcas && hasShorts;

  const entries: { label: string; href: string; order: number }[] = [];
  for (const c of cats) {
    if (combo && (c.slug === "calcas" || c.slug === "shorts")) continue;
    entries.push({ label: c.name, href: `/categoria/${c.slug}`, order: c.menuOrder });
  }
  if (combo) {
    const ref = bySlug.get("calcas")!;
    entries.push({
      label: "Calças e Shorts",
      href: "/produtos?categoria=calcas,shorts",
      order: ref.menuOrder,
    });
  }
  entries.sort(
    (a, b) => a.order - b.order || a.label.localeCompare(b.label, "pt-BR")
  );

  const items: MenuItem[] = [{ label: "Novidades", href: "/produtos" }];
  for (const e of entries) items.push({ label: e.label, href: e.href });
  if (offersCount > 0) items.push({ label: "Ofertas", href: "/ofertas" });
  return items;
}

/** Cards "Compre por categoria" da home. */
export function buildHomeCategories(all: NavCategory[]): NavCategory[] {
  return nonEmpty(all)
    .filter((c) => c.showInHome)
    .sort(byOrder);
}
