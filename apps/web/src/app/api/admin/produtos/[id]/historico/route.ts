import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const items = await prisma.historicoPreco.findMany({
      where: { produto_id: id },
      include: { usuario: { select: { name: true, email: true } } },
      orderBy: { criado_em: "desc" },
    });
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[admin:produto:historico]", err);
    return NextResponse.json({ error: "Erro ao carregar histórico" }, { status: 500 });
  }
}
