export type SaleInput = {
  total: unknown;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  refund?: { status: string; amount: unknown } | null;
};

export type MetricasVendas = {
  receitaBruta: number;
  valoresEstornados: number;
  receitaAposEstornos: number;
  ticketMedio: number;
  vendasPorOrigem: Array<{ origem: string; pedidos: number; receita: number }>;
};

export function summarizeSales(sales: SaleInput[]): MetricasVendas {
  // Use integer cents to avoid floating point
  let receitaBrutaCents = 0;
  let valoresEstornadosCents = 0;

  const porOrigem = new Map<string, { pedidos: number; receitaCents: number }>();

  for (const sale of sales) {
    const totalCents = Math.round(Number(sale.total) * 100);
    receitaBrutaCents += totalCents;

    if (sale.refund && sale.refund.status === "APPROVED") {
      valoresEstornadosCents += Math.round(Number(sale.refund.amount) * 100);
    }

    const origem = sale.utmSource || "origem desconhecida";
    const atual = porOrigem.get(origem) || { pedidos: 0, receitaCents: 0 };
    atual.pedidos++;
    atual.receitaCents += totalCents;
    porOrigem.set(origem, atual);
  }

  const vendasPorOrigem = Array.from(porOrigem.entries()).map(([origem, d]) => ({
    origem,
    pedidos: d.pedidos,
    receita: d.receitaCents / 100,
  }));

  return {
    receitaBruta: receitaBrutaCents / 100,
    valoresEstornados: valoresEstornadosCents / 100,
    receitaAposEstornos: (receitaBrutaCents - valoresEstornadosCents) / 100,
    ticketMedio: sales.length > 0 ? receitaBrutaCents / 100 / sales.length : 0,
    vendasPorOrigem,
  };
}
