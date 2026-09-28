// Ordem canônica de tamanhos: letras (PP→G3), numéricos crescentes,
// desconhecidos (alfabético) e "Único" por último.

const LETTER_ORDER = ["PP", "P", "M", "G", "GG", "XG", "G1", "G2", "G3"];

function isUnico(size: string): boolean {
  const s = size.trim().toUpperCase();
  return (
    s === "ÚNICO" ||
    s === "UNICO" ||
    s === "U" ||
    s === "ONE SIZE" ||
    s === "TAMANHO ÚNICO" ||
    s === "UNITALLA"
  );
}

function weight(size: string): [number, number | string] {
  const s = size.trim().toUpperCase();
  const letter = LETTER_ORDER.indexOf(s);
  if (letter >= 0) return [0, letter];
  const num = parseFloat(s.replace(",", "."));
  if (!Number.isNaN(num)) return [1, num];
  if (isUnico(size)) return [3, 0];
  return [2, s];
}

function compareWeight(
  a: [number, number | string],
  b: [number, number | string]
): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (typeof a[1] === "number" && typeof b[1] === "number") return a[1] - b[1];
  return String(a[1]).localeCompare(String(b[1]), "pt-BR");
}

export function ordenarTamanhos(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const w = compareWeight(weight(a), weight(b));
    return w !== 0 ? w : a.localeCompare(b, "pt-BR");
  });
}
