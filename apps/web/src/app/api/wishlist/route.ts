import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Estrutura de wishlist — habilitada/desabilitada via features.wishlist em
// packages/config/src/defaults.ts (seção 3.5 das instruções).
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const items = await prisma.wishlistItem.findMany({
      where: { userId: session.sub },
      include: { product: { include: { category: true } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ items: items.map((i) => i.product) });
  } catch (err) {
    console.error("[wishlist:list]", err);
    return NextResponse.json({ error: "Erro ao carregar lista" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const body = await req.json();
    const parsed = z.object({ productId: z.string().min(1) }).safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Produto inválido" }, { status: 400 });
    }

    const product = await prisma.product.findFirst({
      where: { id: parsed.data.productId, deletedAt: null },
    });
    if (!product) return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });

    const existing = await prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId: session.sub, productId: product.id } },
    });

    if (existing) {
      await prisma.wishlistItem.delete({ where: { id: existing.id } });
      return NextResponse.json({ active: false });
    }

    await prisma.wishlistItem.create({
      data: { userId: session.sub, productId: product.id },
    });
    return NextResponse.json({ active: true }, { status: 201 });
  } catch (err) {
    console.error("[wishlist:toggle]", err);
    return NextResponse.json({ error: "Erro ao atualizar lista" }, { status: 500 });
  }
}
