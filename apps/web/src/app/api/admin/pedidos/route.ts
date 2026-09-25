import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import type { OrderStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const status = req.nextUrl.searchParams.get("status") || "";
    const orders = await prisma.order.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status: status as OrderStatus } : {}),
      },
      include: {
        items: true,
        user: { select: { id: true, name: true, email: true } },
        address: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ items: orders });
  } catch (err) {
    console.error("[admin:pedidos:list]", err);
    return NextResponse.json({ error: "Erro ao carregar pedidos" }, { status: 500 });
  }
}
