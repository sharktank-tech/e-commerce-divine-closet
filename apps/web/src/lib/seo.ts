// Builders de SEO (títulos, descrições, URLs absolutas).

export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL || "https://www.divinecloset.com.br"
  ).replace(/\/$/, "");
}

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** corta sem quebrar palavra, com reticências */
export function truncate(text: string, max: number): string {
  const s = (text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max).replace(/\s+\S*$/, "");
  return `${cut}…`;
}

const CATEGORY_FEMININE: Record<string, string> = {
  "Moda Praia": "Moda Praia feminina",
};

export function buildCategoryTitle(name: string): string {
  return CATEGORY_FEMININE[name] || `${name} femininos`;
}

export function buildCategoryDescription(name: string): string {
  return `${name} com entrega para todo o Brasil e troca em 30 dias. Confira a seleção Divine Closet.`;
}

export function buildProductTitle(name: string, color?: string | null, category?: string | null): string {
  const parts = [name + (color ? ` ${color}` : "")];
  if (category) parts.push(category);
  return parts.join(" | ");
}

export function buildProductDescription(
  metaDescription?: string | null,
  descricao?: string | null
): string {
  if (metaDescription && metaDescription.trim() !== "") {
    return truncate(metaDescription, 160);
  }
  return truncate(descricao || "", 150);
}
