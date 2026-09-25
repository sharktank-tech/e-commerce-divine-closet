import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

// Usuários e permissões do painel (seção 4.8).
export async function GET() {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const users = await prisma.user.findMany({
      where: { deletedAt: null, role: { not: "CLIENT" } },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ users });
  } catch (err) {
    console.error("[admin:usuarios]", err);
    return NextResponse.json({ error: "Erro ao carregar usuários" }, { status: 500 });
  }
}
