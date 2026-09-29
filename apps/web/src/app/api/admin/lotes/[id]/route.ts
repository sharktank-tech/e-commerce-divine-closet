import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const lote = await prisma.loteCompra.findUnique({ where: { id } });
    if (!lote) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    const produtos = await prisma.product.findMany({
      where: { lote_id: id, deletedAt: null },
      select: { id: true, name: true, slug: true, price: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ lote, produtos });
  } catch (err) {
    console.error("[admin:lote:get]", err);
    return NextResponse.json({ error: "Erro ao carregar lote" }, { status: 500 });
  }
}

const updateSchema = z.object({
  nome: z.string().min(2).optional(),
  data_compra: z.string().min(8).optional(),
  valor_mercadoria_centavos: z.number().int().min(0).optional(),
  valor_frete_centavos: z.number().int().min(0).optional(),
  quantidade_pecas: z.number().int().min(1).optional(),
  categoria_id: z.string().nullish(),
  observacoes: z.string().nullish(),
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
    const lote = await prisma.loteCompra.update({
      where: { id },
      data: {
        ...(d.nome !== undefined ? { nome: d.nome.trim() } : {}),
        ...(d.data_compra !== undefined ? { data_compra: new Date(d.data_compra) } : {}),
        ...(d.valor_mercadoria_centavos !== undefined
          ? { valor_mercadoria_centavos: d.valor_mercadoria_centavos }
          : {}),
        ...(d.valor_frete_centavos !== undefined
          ? { valor_frete_centavos: d.valor_frete_centavos }
          : {}),
        ...(d.quantidade_pecas !== undefined ? { quantidade_pecas: d.quantidade_pecas } : {}),
        ...(d.categoria_id !== undefined ? { categoria_id: d.categoria_id || null } : {}),
        ...(d.observacoes !== undefined ? { observacoes: d.observacoes || null } : {}),
      },
    });
    return NextResponse.json({ lote });
  } catch (err) {
    console.error("[admin:lote:patch]", err);
    return NextResponse.json({ error: "Erro ao atualizar lote" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const vinculados = await prisma.product.count({ where: { lote_id: id, deletedAt: null } });
    if (vinculados > 0) {
      return NextResponse.json(
        { error: `Lote tem ${vinculados} produto(s) vinculado(s). Desvincule antes de excluir.` },
        { status: 409 }
      );
    }
    await prisma.loteCompra.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin:lote:delete]", err);
    return NextResponse.json({ error: "Erro ao excluir lote" }, { status: 500 });
  }
}
