import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

export async function GET() {
  try {
    const categories = await prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });
    return NextResponse.json({ items: categories });
  } catch (err) {
    console.error("[categorias]", err);
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
