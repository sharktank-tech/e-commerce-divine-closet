import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { calcularSnapshot, metricasSobrePreco } from "@/lib/precificacao-server";

const bodySchema = z.object({
  // pré-visualização (sem alterar nada)
  ids: z.array(z.string()).max(200).optional(),
  // aplicação confirmada (só estes têm o preço atualizado)
  aplicar: z.array(z.string()).max(200).optional(),
});

function reaisParaCentavos(v: unknown): number {
  const n = typeof v === "object" && v !== null && "toString" in v ? Number(String(v)) : Number(v);
  return Math.round(n * 100);
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    // 2ª etapa: aplica o preço sugerido (recalculado na hora) aos confirmados.
    if (parsed.data.aplicar && parsed.data.aplicar.length > 0) {
      const products = await prisma.product.findMany({
        where: { id: { in: parsed.data.aplicar }, deletedAt: null },
      });
      let aplicados = 0;
      for (const p of products) {
        const snap = await calcularSnapshot({
          loteId: p.lote_id,
          custoPecaManualCentavos: p.lote_id ? null : p.custo_peca_centavos,
          markupProduto: p.markup_percentual,
          custosExtrasCentavos: p.custos_extras_centavos,
          custosExtrasDescricao: p.custos_extras_descricao,
        });
        if (!snap) continue;
        await prisma.product.update({
          where: { id: p.id },
          data: {
            price: snap.precoSugerido / 100,
            custo_peca_centavos: snap.custoPeca,
            custo_embalagem_centavos: snap.custoEmbalagem,
            preco_sugerido_centavos: snap.precoSugerido,
            precificacao_calculada_em: new Date(),
          },
        });
        aplicados++;
      }
      return NextResponse.json({ ok: true, aplicados });
    }

    // 1ª etapa: diff sem alterar nada.
    const ids = parsed.data.ids ?? [];
    const products =
      ids.length > 0
        ? await prisma.product.findMany({ where: { id: { in: ids }, deletedAt: null } })
        : await prisma.product.findMany({
            where: { deletedAt: null, precificacao_calculada_em: { not: null } },
            take: 200,
          });

    const diffs = [];
    for (const p of products) {
      const snap = await calcularSnapshot({
        loteId: p.lote_id,
        custoPecaManualCentavos: p.lote_id ? null : p.custo_peca_centavos,
        markupProduto: p.markup_percentual,
        custosExtrasCentavos: p.custos_extras_centavos,
        custosExtrasDescricao: p.custos_extras_descricao,
      });
      if (!snap) continue;
      const precoAtual = reaisParaCentavos(p.price);
      const metAtual = await metricasSobrePreco(precoAtual, snap.custoTotal);
      const metSugerida = await metricasSobrePreco(snap.precoSugerido, snap.custoTotal);
      diffs.push({
        id: p.id,
        name: p.name,
        slug: p.slug,
        custoTotal: snap.custoTotal,
        precoAtual,
        precoSugerido: snap.precoSugerido,
        margemAtual: metAtual.margemRealPercentual,
        margemSugerida: metSugerida.margemRealPercentual,
        abaixoMinima: metAtual.abaixoMinima,
      });
    }
    return NextResponse.json({ diffs });
  } catch (err) {
    console.error("[admin:produtos:recalcular]", err);
    return NextResponse.json({ error: "Erro ao recalcular" }, { status: 500 });
  }
}
