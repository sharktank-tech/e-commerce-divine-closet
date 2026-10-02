// Conversão de texto digitado (R$ com vírgula) para centavos — contrato
// CLIENTE: entrada string de formulário, nunca negativa, nunca NaN.
// (No servidor, com Decimal do Prisma, usar `reaisParaCentavos` de
// @/lib/carrinho-revalidacao — contratos diferentes, implementações separadas.)
export function reaisParaCentavosTexto(v: string): number {
  return Math.max(0, Math.round(Number(String(v).replace(",", ".")) * 100) || 0);
}
