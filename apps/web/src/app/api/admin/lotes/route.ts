import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

export async function GET() {
  try {
    const rows = await prisma.loteCompra.findMany({ orderBy: { data_compra: "desc" } });
    const counts = await Promise.all(
      rows.map((l) => prisma.product.count({ where: { lote_id: l.id, deletedAt: null } }))
    );
    const items = rows.map((l, i) => ({ ...l, produtosVinculados: counts[i] }));
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[admin:lotes:list]", err);
    return NextResponse.json({ error: "Erro ao carregar lotes" }, { status: 500 });
  }
}

const createSchema = z.object({
  nome: z.string().min(2, "Nome muito curto"),
  data_compra: z.string().min(8, "Data inválida"),
  valor_mercadoria_centavos: z.number().int().min(0),
  valor_frete_centavos: z.number().int().min(0),
  quantidade_pecas: z.number().int().min(1, "Quantidade deve ser maior que zero"),
  categoria_id: z.string().nullish(),
  observacoes: z.string().nullish(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }
    const d = parsed.data;
    const lote = await prisma.loteCompra.create({
      data: {
        nome: d.nome.trim(),
        data_compra: new Date(d.data_compra),
        valor_mercadoria_centavos: d.valor_mercadoria_centavos,
        valor_frete_centavos: d.valor_frete_centavos,
        quantidade_pecas: d.quantidade_pecas,
        categoria_id: d.categoria_id || null,
        observacoes: d.observacoes || null,
      },
    });
    return NextResponse.json({ lote }, { status: 201 });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
      return NextResponse.json({ error: "Já existe um lote com esse nome" }, { status: 409 });
    }
    console.error("[admin:lotes:create]", err);
    return NextResponse.json({ error: "Erro ao criar lote" }, { status: 500 });
  }
}
