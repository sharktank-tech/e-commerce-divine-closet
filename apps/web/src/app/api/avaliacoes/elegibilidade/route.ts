import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Elegibilidade: pedido pago/entregue do usuário contendo o produto,
// sem avaliação já enviada para aquele pedido+produto.
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ eligible: false });

    const productId = req.nextUrl.searchParams.get("produtoId") || "";
    if (!productId) return NextResponse.json({ eligible: false });

    const order = await prisma.order.findFirst({
      where: {
        userId: session.sub,
        deletedAt: null,
        OR: [{ paymentStatus: "PAID" }, { status: "DELIVERED" }],
        items: { some: { productId } },
        reviews: { none: { productId } },
      },
      select: { id: true, number: true },
      orderBy: { createdAt: "desc" },
    });

    if (!order) return NextResponse.json({ eligible: false });
    return NextResponse.json({ eligible: true, orderId: order.id, orderNumber: order.number });
  } catch (err) {
    console.error("[avaliacoes:elegibilidade]", err);
    return NextResponse.json({ eligible: false });
  }
}
