// Formatação da quantidade do carrinho para o badge do header.
// Retorna null quando vazio (badge oculto).
export function formatCartCount(total: number): string | null {
  const n = Math.max(0, Math.floor(total || 0));
  if (n === 0) return null;
  if (n > 9) return "9+";
  return String(n);
}
