// Recomendações: complementos por categoria ("Complete o look").
// Chaves e valores são slugs de categoria.

export const COMPLEMENTOS: Record<string, string[]> = {
  vestidos: ["jaquetas-e-casacos", "conjuntos", "moda-praia"],
  blusas: ["calcas", "saias", "shorts"],
  tops: ["calcas", "saias", "shorts"],
  calcas: ["blusas", "jaquetas-e-casacos", "tops"],
  saias: ["blusas", "tops", "jaquetas-e-casacos"],
  shorts: ["blusas", "tops", "moda-praia"],
  conjuntos: ["moda-praia", "jaquetas-e-casacos"],
  macacoes: ["jaquetas-e-casacos", "blusas"],
  "jaquetas-e-casacos": ["vestidos", "calcas", "blusas"],
  "moda-praia": ["vestidos", "shorts", "conjuntos"],
};

export function complementosPara(slug: string): string[] {
  return COMPLEMENTOS[slug] || [];
}

// recentes vistos (localStorage): unshift sem repetir, teto max
export function pushRecent(list: string[], id: string, max = 12): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}
