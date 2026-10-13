// Regra de abandono de carrinho — pura e testável.
// Só logados (guest não tem e-mail): itens presentes, sem lembrete anterior
// e item mais recente mais velho que o limite.
export const HORAS_ABANDONO = 24;

export function precisaLembrete(
  criadosEm: Date[],
  lembradoEm: Date | null,
  agora: Date = new Date(),
  horas: number = HORAS_ABANDONO
): boolean {
  if (lembradoEm) return false;
  if (criadosEm.length === 0) return false;
  const recente = Math.max(...criadosEm.map((d) => d.getTime()));
  return agora.getTime() - recente >= horas * 3_600_000;
}
