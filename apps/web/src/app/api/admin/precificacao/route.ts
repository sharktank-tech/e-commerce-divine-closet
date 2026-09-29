import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

export async function GET() {
  try {
    let config = await prisma.configPrecificacao.findFirst();
    if (!config) {
      config = await prisma.configPrecificacao.create({ data: {} });
    }
    const materiais = await prisma.materiaisEmbalagem.findMany({
      orderBy: { ordem: "asc" },
    });
    return NextResponse.json({ config, materiais });
  } catch (err) {
    console.error("[admin:precificacao:get]", err);
    return NextResponse.json({ error: "Erro ao carregar precificação" }, { status: 500 });
  }
}

const configSchema = z.object({
  markup_padrao_percentual: z.number().int().min(0).max(1000).optional(),
  regra_arredondamento_custo: z
    .enum(["nenhum", "inteiro_mais_proximo", "inteiro_para_cima", "multiplo_de_X"])
    .optional(),
  regra_final_preco: z.enum(["termina_99", "nenhuma"]).optional(),
  rateio_frete: z.enum(["igual", "proporcional_ao_custo"]).optional(),
  embalagem_entra_no_markup: z.boolean().optional(),
  margem_minima_percentual: z.number().int().min(0).max(100).nullish(),
  taxa_pagamento_percentual: z.number().int().min(0).max(100).nullish(),
});

export async function PUT(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const body = await req.json();
    const parsed = configSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const d = parsed.data;
    let config = await prisma.configPrecificacao.findFirst();
    const data = {
      ...(d.markup_padrao_percentual !== undefined
        ? { markup_padrao_percentual: d.markup_padrao_percentual }
        : {}),
      ...(d.regra_arredondamento_custo !== undefined
        ? { regra_arredondamento_custo: d.regra_arredondamento_custo }
        : {}),
      ...(d.regra_final_preco !== undefined ? { regra_final_preco: d.regra_final_preco } : {}),
      ...(d.rateio_frete !== undefined ? { rateio_frete: d.rateio_frete } : {}),
      ...(d.embalagem_entra_no_markup !== undefined
        ? { embalagem_entra_no_markup: d.embalagem_entra_no_markup }
        : {}),
      ...(d.margem_minima_percentual !== undefined
        ? { margem_minima_percentual: d.margem_minima_percentual }
        : {}),
      ...(d.taxa_pagamento_percentual !== undefined
        ? { taxa_pagamento_percentual: d.taxa_pagamento_percentual }
        : {}),
    };
    config = config
      ? await prisma.configPrecificacao.update({ where: { id: config.id }, data })
      : await prisma.configPrecificacao.create({ data });
    return NextResponse.json({ config });
  } catch (err) {
    console.error("[admin:precificacao:put]", err);
    return NextResponse.json({ error: "Erro ao salvar precificação" }, { status: 500 });
  }
}
