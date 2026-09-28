import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

const columnSchema = z.object({ key: z.string().min(1), label: z.string().min(1) });
const rowSchema = z.object({
  size: z.string().min(1),
  values: z.record(z.string(), z.string()),
});

const tableSchema = z.object({
  name: z.string().min(2),
  unit: z.string().min(1).max(8).default("cm"),
  columns: z.array(columnSchema).min(1, "Adicione ao menos 1 coluna"),
  rows: z.array(rowSchema).default([]),
  note: z.string().nullish(),
});

export async function GET() {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();
    const items = await prisma.sizeTable.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[admin:tabelas:list]", err);
    return NextResponse.json({ error: "Erro ao carregar tabelas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const body = await req.json();
    const parsed = tableSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    const table = await prisma.sizeTable.create({ data: { ...parsed.data, note: parsed.data.note || null } });
    return NextResponse.json({ table }, { status: 201 });
  } catch (err) {
    console.error("[admin:tabelas:create]", err);
    return NextResponse.json({ error: "Erro ao criar tabela" }, { status: 500 });
  }
}
