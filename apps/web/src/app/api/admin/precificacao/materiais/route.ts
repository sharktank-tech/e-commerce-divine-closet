import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

export async function GET() {
  try {
    const materiais = await prisma.materiaisEmbalagem.findMany({
      orderBy: { ordem: "asc" },
    });
    return NextResponse.json({ items: materiais });
  } catch (err) {
    console.error("[admin:materiais:list]", err);
    return NextResponse.json({ error: "Erro ao carregar materiais" }, { status: 500 });
  }
}

const createSchema = z.object({
  nome: z.string().min(2, "Nome muito curto"),
  // dois modos de preenchimento: unitário direto ou "comprei X por R$ Y"
  custo_unitario_centavos: z.number().int().min(0).optional(),
  quantidade_comprada: z.number().int().min(1).optional(),
  valor_total_comprado_centavos: z.number().int().min(1).optional(),
  ativo: z.boolean().optional(),
  ordem: z.number().int().optional(),
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
    let unitario = d.custo_unitario_centavos;
    if (unitario === undefined) {
      if (!d.quantidade_comprada || !d.valor_total_comprado_centavos) {
        return NextResponse.json(
          { error: "Informe o custo unitário ou quantidade + valor total da compra" },
          { status: 400 }
        );
      }
      // "comprei X unidades por R$ Y" → unitário (sempre grava o unitário)
      unitario = Math.round(d.valor_total_comprado_centavos / d.quantidade_comprada);
    }
    const maxOrdem = await prisma.materiaisEmbalagem.aggregate({ _max: { ordem: true } });
    const material = await prisma.materiaisEmbalagem.create({
      data: {
        nome: d.nome.trim(),
        custo_unitario_centavos: unitario,
        ativo: d.ativo ?? true,
        ordem: d.ordem ?? (maxOrdem._max.ordem ?? 0) + 1,
      },
    });
    return NextResponse.json({ material }, { status: 201 });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
      return NextResponse.json({ error: "Já existe um material com esse nome" }, { status: 409 });
    }
    console.error("[admin:materiais:create]", err);
    return NextResponse.json({ error: "Erro ao criar material" }, { status: 500 });
  }
}
