import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

const INACTIVE_DAYS = 90;

export async function GET(_req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const customers = await prisma.user.findMany({
      where: { role: "CLIENT", deletedAt: null },
      include: {
        _count: { select: { orders: true, addresses: true } },
        orders: {
          select: { total: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const cutoff = Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000;

    const items = customers.map((c) => {
      const lastOrder = c.orders[0] || null;
      const lastActivity = lastOrder ? lastOrder.createdAt.getTime() : c.createdAt.getTime();
      const recent = lastActivity >= cutoff;

      // Segmentação básica (seção 4.5):
      // recorrente = 2+ pedidos | novo = <=1 pedido e atividade recente | inativo = 90d+ sem atividade
      const segment = c._count.orders >= 2 ? "recorrente" : recent ? "novo" : "inativo";

      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        active: c.active,
        createdAt: c.createdAt,
        ordersCount: c._count.orders,
        totalSpent: c.orders.reduce((s, o) => s + Number(o.total), 0),
        lastOrder,
        segment,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[admin:clientes]", err);
    return NextResponse.json({ error: "Erro ao carregar clientes" }, { status: 500 });
  }
}
