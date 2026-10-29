import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { summarizeSales } from "@/lib/marketing/metrics";
export async function GET(req: NextRequest) {
  if (!(await requireAuth("ADMIN"))) return forbidden();
  const start = req.nextUrl.searchParams.get("inicio"),
    end = req.nextUrl.searchParams.get("fim");
  const valid = (s: string | null) =>
    !s ||
    (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
      !isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s);
  if (!valid(start) || !valid(end) || (start && end && start > end))
    return NextResponse.json({ error: "Período inválido." }, { status: 400 });
  const excluded = (req.nextUrl.searchParams.get("excluir") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (excluded.length > 100)
    return NextResponse.json(
      { error: "Máximo de 100 pedidos excluídos." },
      { status: 400 },
    );
  const from = start ? new Date(`${start}T00:00:00-03:00`) : undefined;
  const to = end
    ? new Date(new Date(`${end}T00:00:00-03:00`).getTime() + 86_400_000)
    : undefined;
  const orders = await prisma.order.findMany({
    where: {
      paymentStatus: { in: ["PAID", "REFUNDED"] },
      number: { notIn: excluded },
      ...(from || to ? { createdAt: { gte: from, lt: to } } : {}),
    },
    select: {
      total: true,
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      refund: { select: { status: true, amount: true } },
    },
  });
  const subscribers = await prisma.newsletterSubscriber.groupBy({
    by: ["status"],
    _count: true,
  });
  const count = (s: string) =>
    subscribers.find((x) => x.status === s)?._count || 0;
  const campaigns = await prisma.marketingCampaign.groupBy({
    by: ["status"],
    _count: true,
  });
  const messages = await prisma.marketingMessage.groupBy({
    by: ["status"],
    where: { kind: "CAMPAIGN" },
    _count: true,
  });
  return NextResponse.json(
    {
      ...summarizeSales(orders),
      assinantes: {
        confirmados: count("confirmed"),
        cancelados: count("unsubscribed"),
        pendentes: count("pending"),
      },
      campanhas: {
        rascunho: campaigns.find((x) => x.status === "DRAFT")?._count || 0,
        enfileiradas: campaigns.find((x) => x.status === "QUEUED")?._count || 0,
        processadas: messages.find((x) => x.status === "ACCEPTED")?._count || 0,
        falhas: messages.find((x) => x.status === "FAILED")?._count || 0,
      },
      periodo: {
        inicio: start,
        fim: end,
        data: "Order.createdAt",
        fuso: "America/Sao_Paulo",
        excluidos: excluded,
      },
      nota: "Coorte por criação do pedido; inclui pagos e estornados. Estornos APPROVED desta coorte, mesmo posteriores ao período. Não é fluxo de caixa nem lucro. Assinantes e campanhas são totais atuais.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
