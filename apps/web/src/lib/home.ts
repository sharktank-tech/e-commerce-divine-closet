// Montagem sequencial das seções da home (Tarefa 5): cada seção consome
// produtos ainda não exibidos, garantindo exclusão mútua.

export type HomeItem = { id: string };

/** remove itens cujos ids já foram usados em seções anteriores */
export function excludeUsed<T extends HomeItem>(items: T[], used: Set<string>): T[] {
  return items.filter((i) => !used.has(i.id));
}

/** pega até n itens frescos e marca os ids como usados */
export function takeFresh<T extends HomeItem>(items: T[], used: Set<string>, n: number): T[] {
  const picked = excludeUsed(items, used).slice(0, n);
  for (const p of picked) used.add(p.id);
  return picked;
}

/** seção só renderiza com itens suficientes para uma fileira (4) */
export function shouldShow<T>(section: T[]): boolean {
  return section.length >= 4;
}
