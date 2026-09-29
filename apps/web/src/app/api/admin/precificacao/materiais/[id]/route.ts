import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  nome: z.string().min(2).optional(),
  custo_unitario_centavos: z.number().int().min(0).optional(),
  quantidade_comprada: z.number().int().min(1).optional(),
  valor_total_comprado_centavos: z.number().int().min(1).optional(),
  ativo: z.boolean().optional(),
  ordem: z.number().int().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const d = parsed.data;
    let unitario = d.custo_unitario_centavos;
    if (unitario === undefined && d.quantidade_comprada && d.valor_total_comprado_centavos) {
      unitario = Math.round(d.valor_total_comprado_centavos / d.quantidade_comprada);
    }
    const material = await prisma.materiaisEmbalagem.update({
      where: { id },
      data: {
        ...(d.nome !== undefined ? { nome: d.nome.trim() } : {}),
        ...(unitario !== undefined ? { custo_unitario_centavos: unitario } : {}),
        ...(d.ativo !== undefined ? { ativo: d.ativo } : {}),
        ...(d.ordem !== undefined ? { ordem: d.ordem } : {}),
      },
    });
    return NextResponse.json({ material });
  } catch (err) {
    console.error("[admin:material:patch]", err);
    return NextResponse.json({ error: "Erro ao atualizar material" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    await prisma.materiaisEmbalagem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin:material:delete]", err);
    return NextResponse.json({ error: "Erro ao excluir material" }, { status: 500 });
  }
}
