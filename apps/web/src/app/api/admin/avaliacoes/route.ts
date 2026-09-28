import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status") || "";
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = 20;

    const where = {
      deletedAt: null,
      ...(["PENDENTE", "APROVADA", "REJEITADA"].includes(status)
        ? { status: status as "PENDENTE" | "APROVADA" | "REJEITADA" }
        : {}),
    };

    const [total, pendentes, items] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.count({ where: { deletedAt: null, status: "PENDENTE" } }),
      prisma.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { name: true, email: true } },
          product: { select: { name: true, slug: true } },
          order: { select: { number: true } },
          fotos: { orderBy: { ordem: "asc" } },
        },
      }),
    ]);

    return NextResponse.json({ items, total, pendentes, page });
  } catch (err) {
    console.error("[admin:avaliacoes:list]", err);
    return NextResponse.json({ error: "Erro ao carregar avaliações" }, { status: 500 });
  }
}
