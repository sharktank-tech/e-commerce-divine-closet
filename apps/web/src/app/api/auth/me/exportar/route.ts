import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// LGPD — portabilidade: devolve todos os dados pessoais da conta em JSON
// (perfil, endereços, pedidos com itens, avaliações, wishlist).
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: {
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
        deletedAt: true,
        addresses: true,
        orders: { include: { items: true }, orderBy: { createdAt: "desc" } },
        reviews: true,
        wishlist: { include: { product: { select: { id: true, name: true, slug: true } } } },
      },
    });
    if (!user || user.deletedAt) {
      return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
    }

    return NextResponse.json({
      exportadoEm: new Date().toISOString(),
      conta: user,
    });
  } catch (err) {
    console.error("[me:exportar]", err);
    return NextResponse.json({ error: "Erro ao exportar dados" }, { status: 500 });
  }
}
