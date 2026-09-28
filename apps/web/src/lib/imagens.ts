// Metadados paralelos às imagens do produto (cor vinculada + alt).

/** alinha os arrays ao tamanho de images (preenche "" / trunca) */
export function normalizeImageMeta(
  images: string[],
  colors?: (string | null)[] | null,
  alts?: (string | null)[] | null
): { colors: string[]; alts: string[] } {
  const n = images.length;
  const pad = (arr?: (string | null)[] | null): string[] =>
    Array.from({ length: n }, (_, i) => arr?.[i] || "");
  return { colors: pad(colors), alts: pad(alts) };
}

/** índice da primeira imagem vinculada à cor (case-insensitive) */
export function findColorIndex(
  imageColors: (string | null)[],
  targetColor: string
): number {
  const t = targetColor.trim().toLowerCase();
  if (!t) return -1;
  return imageColors.findIndex((c) => (c || "").trim().toLowerCase() === t);
}

/** alt padrão: "{Nome}, {cor}, vista {n}" */
export function describeAlt(
  productName: string,
  index: number,
  color?: string | null,
  customAlt?: string | null
): string {
  if (customAlt && customAlt.trim() !== "") return customAlt.trim();
  const cor = color && color.trim() !== "" ? `, ${color.trim()}` : "";
  return `${productName}${cor}, vista ${index + 1}`;
}
