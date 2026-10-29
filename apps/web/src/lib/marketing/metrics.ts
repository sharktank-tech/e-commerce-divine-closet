import { Prisma } from "@prisma/client";
type Sale = {
  total: Prisma.Decimal | string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  refund: { status: string; amount: Prisma.Decimal | string } | null;
};
export function summarizeSales(orders: Sale[]) {
  const D = Prisma.Decimal;
  let gross = new D(0),
    refunds = new D(0);
  const origins = new Map<
    string,
    {
      origem: string;
      medium: string;
      campanha: string;
      pedidos: number;
      receita: Prisma.Decimal;
    }
  >();
  for (const o of orders) {
    const total = new D(o.total);
    gross = gross.plus(total);
    if (o.refund?.status === "APPROVED")
      refunds = refunds.plus(o.refund.amount);
    const origem = o.utmSource || "origem desconhecida",
      medium = o.utmMedium || "desconhecido",
      campanha = o.utmCampaign || "desconhecida";
    const key = JSON.stringify([origem, medium, campanha]);
    const row = origins.get(key) || {
      origem,
      medium,
      campanha,
      pedidos: 0,
      receita: new D(0),
    };
    row.pedidos++;
    row.receita = row.receita.plus(total);
    origins.set(key, row);
  }
  const money = (v: Prisma.Decimal) => v.toDecimalPlaces(2).toNumber();
  return {
    pedidosPagos: orders.length,
    receitaBruta: money(gross),
    valoresEstornados: money(refunds),
    receitaAposEstornos: money(gross.minus(refunds)),
    ticketMedio: orders.length ? money(gross.div(orders.length)) : 0,
    vendasPorOrigem: [...origins.values()].map((o) => ({
      ...o,
      receita: money(o.receita),
    })),
  };
}
