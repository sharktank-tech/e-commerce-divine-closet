import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  unit: z.string().min(1).max(8).optional(),
  columns: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) })).min(1).optional(),
  rows: z.array(z.object({ size: z.string().min(1), values: z.record(z.string(), z.string()) })).optional(),
  note: z.string().nullish(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    const table = await prisma.sizeTable.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ table });
  } catch (err) {
    console.error("[admin:tabela:patch]", err);
    return NextResponse.json({ error: "Erro ao atualizar tabela" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const inUse =
      (await prisma.product.count({ where: { tabelaMedidasId: id } })) +
      (await prisma.category.count({ where: { sizeTableId: id } }));
    if (inUse > 0) {
      return NextResponse.json(
        { error: `Tabela em uso por ${inUse} registro(s). Desvincule antes de excluir.` },
        { status: 409 }
      );
    }

    await prisma.sizeTable.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin:tabela:delete]", err);
    return NextResponse.json({ error: "Erro ao excluir tabela" }, { status: 500 });
  }
}
