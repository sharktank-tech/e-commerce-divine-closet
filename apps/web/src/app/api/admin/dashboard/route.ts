import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { toNumber } from "@/lib/utils";
import { stockAlertThreshold } from "@/config/defaults";

export async function GET() {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const seriesSince = new Date();
    seriesSince.setDate(seriesSince.getDate() - 13);
    seriesSince.setHours(0, 0, 0, 0);

    const [
      revenueAgg,
      ordersMonth,
      ordersTotal,
      customers,
      products,
      pending,
      revenueAggMonth,
      paidCount,
      paidInSeries,
      topRaw,
    ] = await Promise.all([
      prisma.order.aggregate({
        _sum: { total: true },
        where: { paymentStatus: "PAID" },
      }),
      prisma.order.count({
        where: { createdAt: { gte: startOfMonth }, paymentStatus: "PAID" },
      }),
      prisma.order.count(),
      prisma.user.count({ where: { role: "CLIENT", deletedAt: null } }),
      prisma.product.count({ where: { isActive: true, deletedAt: null } }),
      prisma.order.count({ where: { status: "PENDING" } }),
      prisma.order.aggregate({
        _sum: { total: true },
        where: { paymentStatus: "PAID", createdAt: { gte: startOfMonth } },
      }),
      prisma.order.count({ where: { paymentStatus: "PAID" } }),
      prisma.order.findMany({
        where: { paymentStatus: "PAID", createdAt: { gte: seriesSince } },
        select: { createdAt: true, total: true },
      }),
      prisma.orderItem.groupBy({
        by: ["productName"],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 6,
      }),
    ]);

    // Série de vendas dos últimos 14 dias (por dia).
    const series = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      d.setHours(0, 0, 0, 0);
      return {
        date: d.toISOString().slice(0, 10),
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        total: 0,
      };
    });
    const byDate = new Map(series.map((s) => [s.date, s]));
    for (const o of paidInSeries) {
      const bucket = byDate.get(o.createdAt.toISOString().slice(0, 10));
      if (bucket) bucket.total += Number(o.total);
    }
    const salesDemo = series.every((s) => s.total === 0);

    const topProducts = topRaw.map((t) => ({
      name: t.productName,
      quantity: t._sum.quantity || 0,
    }));

    const revenue = toNumber(revenueAgg._sum.total);
    const ticketAvg = paidCount > 0 ? revenue / paidCount : 0;

    const recentOrders = await prisma.order.findMany({
      take: 8,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true, email: true } },
        items: { select: { quantity: true } },
      },
    });

    const lowStock = await prisma.product.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        stock: { lte: stockAlertThreshold },
      },
      orderBy: { stock: "asc" },
      take: 8,
      select: { id: true, name: true, slug: true, stock: true, price: true, images: true },
    });

    const statusCounts = await prisma.order.groupBy({
      by: ["status"],
      _count: { _all: true },
    });

    return NextResponse.json({
      revenue,
      revenueMonth: toNumber(revenueAggMonth._sum.total),
      ordersMonth,
      ordersTotal,
      customers,
      products,
      pending,
      ticketAvg,
      salesSeries: series,
      salesDemo,
      topProducts,
      recentOrders,
      lowStock,
      statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])),
    });
  } catch (err) {
    console.error("[admin:dashboard]", err);
    return NextResponse.json({ error: "Erro ao carregar dashboard" }, { status: 500 });
  }
}
