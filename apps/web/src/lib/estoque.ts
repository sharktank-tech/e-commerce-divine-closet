// Regras de exibição de estoque (Tarefa 7). O número exato nunca aparece,
// exceto a contagem de urgência quando baixo.

export const ESTOQUE_BAIXO_LIMITE = 5;

export type EstadoEstoque = "esgotado" | "baixo" | "disponivel";

export function estadoEstoque(quantidade: number): EstadoEstoque {
  const q = Math.max(0, Math.floor(quantidade || 0));
  if (q <= 0) return "esgotado";
  if (q <= ESTOQUE_BAIXO_LIMITE) return "baixo";
  return "disponivel";
}

export function textoEstoque(quantidade: number): string {
  const estado = estadoEstoque(quantidade);
  if (estado === "esgotado") return "Esgotado";
  if (estado === "baixo")
    return `Restam apenas ${Math.floor(quantidade)} unidade${Math.floor(quantidade) === 1 ? "" : "s"}`;
  return "Em estoque";
}
