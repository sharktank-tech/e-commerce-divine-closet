import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await requireAuth("ADMIN");
  if (!session) return forbidden();

  // Pedidos pagos (status PAID)
  const pedidosPagos = await prisma.order.findMany({
    where: { paymentStatus: "PAID" },
    select: { total: true, couponCode: true, utmSource: true, utmMedium: true, utmCampaign: true },
  });

  // Receita bruta (soma dos totais de pedidos pagos)
  const receitaBruta = pedidosPagos.reduce((s, p) => s + Number(p.total), 0);

  // Valores estornados (pedidos com status refunded)
  const estornados = await prisma.order.findMany({
    where: { status: "REFUNDED" },
    select: { total: true },
  });
  const valoresEstornados = estornados.reduce((s, p) => s + Number(p.total), 0);

  // Receita após estornos
  const receitaAposEstornos = receitaBruta - valoresEstornados;

  // Ticket médio
  const ticketMedio = pedidosPagos.length > 0 ? receitaBruta / pedidosPagos.length : 0;

  // Vendas por origem (UTM)
  const porOrigem = new Map<string, { pedidos: number; receita: number }>();
  for (const p of pedidosPagos) {
    const origem = p.utmSource || "origem desconhecida";
    const atual = porOrigem.get(origem) || { pedidos: 0, receita: 0 };
    atual.pedidos++;
    atual.receita += Number(p.total);
    porOrigem.set(origem, atual);
  }
  const vendasPorOrigem = Array.from(porOrigem.entries()).map(([origem, d]) => ({
    origem,
    pedidos: d.pedidos,
    receita: Math.round(d.receita * 100) / 100,
  }));

  // Assinantes
  const assinantes = await prisma.newsletterSubscriber.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  const assinantesMap = new Map(assinantes.map((a) => [a.status, a._count.status]));
  const assinantesConfirmados = assinantesMap.get("confirmed") || 0;
  const assinantesCancelados = assinantesMap.get("unsubscribed") || 0;
  const assinantesPendentes = assinantesMap.get("pending") || 0;

  return NextResponse.json({
    pedidosPagos: pedidosPagos.length,
    receitaBruta: Math.round(receitaBruta * 100) / 100,
    valoresEstornados: Math.round(valoresEstornados * 100) / 100,
    receitaAposEstornos: Math.round(receitaAposEstornos * 100) / 100,
    ticketMedio: Math.round(ticketMedio * 100) / 100,
    vendasPorOrigem,
    assinantes: {
      confirmados: assinantesConfirmados,
      cancelados: assinantesCancelados,
      pendentes: assinantesPendentes,
    },
    campanhas: {
      rascunho: 0,
      enfileiradas: 0,
      processadas: 0,
      falhas: 0,
    },
  });
}
