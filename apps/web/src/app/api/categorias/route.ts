import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

export async function GET() {
  try {
    const items = await prisma.category.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      orderBy: [{ menuOrder: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { products: true } },
        products: {
          where: { isActive: true, deletedAt: null, stock: { gt: 0 } },
          select: { id: true },
        },
      },
    });
    // availableCount = produtos ativos COM estoque (base do menu/home).
    // _count.products (total) mantido para o admin.
    const shaped = items.map(({ products, ...c }) => ({
      ...c,
      availableCount: products.length,
    }));
    return NextResponse.json({ items: shaped });
  } catch (err) {
    console.error("[admin:categorias:list]", err);
    return NextResponse.json({ error: "Erro ao carregar categorias" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body?.name || "").trim();
    if (name.length < 2) {
      return NextResponse.json({ error: "Nome inválido" }, { status: 400 });
    }

    const category = await prisma.category.upsert({
      where: { name },
      update: { description: body?.description || undefined },
      create: {
        name,
        slug: slugify(name),
        description: body?.description || null,
      },
    });

    return NextResponse.json({ category }, { status: 201 });
  } catch (err) {
    console.error("[categorias:create]", err);
    return NextResponse.json({ error: "Erro ao criar categoria" }, { status: 500 });
  }
}
