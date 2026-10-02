import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { aplicarExclusaoProduto } from "@/lib/produto-exclusao";
import { normalizeImageMeta } from "@/lib/imagens";
import { calcularSnapshot } from "@/lib/precificacao-server";

const updateSchema = productPartial();

function productPartial() {
  return z.object({
    name: z.string().min(2).optional(),
    description: z.string().min(2).optional(),
    price: z.number().positive().optional(),
    comparePrice: z.number().positive().nullish(),
    sku: z.string().nullish(),
    stock: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    featured: z.boolean().optional(),
    images: z.array(z.string()).optional(),
    imageColors: z.array(z.string()).optional(),
    imageAlts: z.array(z.string()).optional(),
    sizes: z.array(z.string()).optional(),
    colors: z.array(z.string()).optional(),
    categoryId: z.string().min(1).optional(),
    tabelaMedidasId: z.string().nullish(),
    relacionados: z.array(z.string()).optional(),
    composicao: z.string().nullish(),
    instrucoesLavagem: z.string().nullish(),
    comprimento: z.string().nullish(),
    modeloAltura: z.string().nullish(),
    modeloVeste: z.string().nullish(),
    caimento: z.string().nullish(),
    ocasiao: z.string().nullish(),
    metaTitle: z.string().nullish(),
    metaDescription: z.string().nullish(),
    // Precificação (opcional): ao informar origem de custo, o servidor
    // recalcula e grava os snapshots. O preço de venda continua livre.
    loteId: z.string().nullish(),
    custoPecaManualCentavos: z.number().int().min(0).nullish(),
    markupProduto: z.number().int().min(0).max(1000).nullish(),
    custosExtrasCentavos: z.number().int().min(0).optional(),
    custosExtrasDescricao: z.string().max(200).nullish(),
    variations: z
      .array(
        z.object({
          size: z.string().min(1),
          color: z.string().nullish(),
          stock: z.number().int().min(0),
          sku: z.string().nullish(),
        })
      )
      .optional(),
  });
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: true, variations: { orderBy: { size: "asc" } } },
    });
    if (!product) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json({ product });
  } catch (err) {
    console.error("[admin:produto:get]", err);
    return NextResponse.json({ error: "Erro ao carregar" }, { status: 500 });
  }
}

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

    const { variations, loteId, custoPecaManualCentavos, markupProduto, custosExtrasCentavos, custosExtrasDescricao, ...rest } = parsed.data;

    // relacionados: mantém só ids existentes (remove o próprio)
    if (rest.relacionados !== undefined) {
      const ids = rest.relacionados.filter(
        (x) => x !== id && /^[0-9a-f-]{36}$/i.test(x)
      );
      const found = await prisma.product.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true },
      });
      (rest as Record<string, unknown>).relacionados = found.map((p) => p.id);
    }

    // mantém imageColors/imageAlts alinhados ao tamanho de images
    if (
      rest.images !== undefined ||
      rest.imageColors !== undefined ||
      rest.imageAlts !== undefined
    ) {
      const current = await prisma.product.findUnique({ where: { id } });
      if (!current) {
        return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
      }
      const meta = normalizeImageMeta(
        rest.images ?? current.images,
        rest.imageColors ?? current.imageColors,
        rest.imageAlts ?? current.imageAlts
      );
      (rest as Record<string, unknown>).imageColors = meta.colors;
      (rest as Record<string, unknown>).imageAlts = meta.alts;
    }

    // discountPercent: derivado via hook do client a partir do price/compare
    // final (lib/desconto-sync.ts) — sem sincronismo manual aqui.

    // Snapshot de precificação: só recalcula quando algum campo de
    // precificação foi informado nesta requisição. Preço de venda nunca
    // muda sozinho. Usa o lote/custo já gravado como fallback.
    const pricingTouched =
      loteId !== undefined ||
      custoPecaManualCentavos !== undefined ||
      markupProduto !== undefined ||
      custosExtrasCentavos !== undefined;
    if (pricingTouched) {
      const current = await prisma.product.findUnique({
        where: { id },
        select: { lote_id: true, custo_peca_centavos: true },
      });
      if (!current) {
        return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
      }
      // Origem final: lote explícito vence; custo manual explícito limpa o lote;
      // senão mantém o que já estava gravado.
      const manualExplicito =
        custoPecaManualCentavos !== undefined && custoPecaManualCentavos !== null;
      const loteFinal =
        loteId !== undefined ? loteId : manualExplicito ? null : current.lote_id;
      const manualFinal = manualExplicito
        ? custoPecaManualCentavos
        : loteFinal
          ? null
          : current.custo_peca_centavos;
      const snap = await calcularSnapshot({
        loteId: loteFinal,
        custoPecaManualCentavos: manualFinal,
        markupProduto: markupProduto ?? null,
        custosExtrasCentavos: custosExtrasCentavos ?? 0,
        custosExtrasDescricao: custosExtrasDescricao ?? null,
      });
      const r = rest as Record<string, unknown>;
      if (snap) {
        r.lote_id = loteFinal || null;
        r.custo_peca_centavos = snap.custoPeca;
        r.custo_embalagem_centavos = snap.custoEmbalagem;
        r.custos_extras_centavos = snap.custosExtras;
        r.custos_extras_descricao = custosExtrasDescricao || null;
        r.markup_percentual = markupProduto ?? null;
        r.preco_sugerido_centavos = snap.precoSugerido;
        r.precificacao_calculada_em = new Date();
      } else {
        // origem removida/inexistente: limpa snapshots sem tocar no preço
        r.lote_id = null;
        r.custo_peca_centavos = 0;
        r.custo_embalagem_centavos = 0;
        r.custos_extras_centavos = 0;
        r.markup_percentual = null;
        r.preco_sugerido_centavos = null;
        r.precificacao_calculada_em = null;
      }
    }

    const product = await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: rest });

      if (variations) {
        await tx.productVariation.deleteMany({ where: { productId: id } });
        if (variations.length > 0) {
          await tx.productVariation.createMany({
            data: variations.map((v) => ({
              productId: id,
              size: v.size,
              color: v.color || null,
              stock: v.stock,
              sku: v.sku || null,
            })),
          });
          const sum = variations.reduce((s, v) => s + v.stock, 0);
          await tx.product.update({ where: { id }, data: { stock: sum } });
        }
      }

      return tx.product.findUnique({
        where: { id },
        include: { category: true, variations: { orderBy: { size: "asc" } } },
      });
    });

    return NextResponse.json({ product });
  } catch (err) {
    console.error("[admin:produto:patch]", err);
    return NextResponse.json({ error: "Erro ao atualizar" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const existing = await prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
    }
    // Com pedidos associados desativa; sem pedidos apaga de vez.
    const modo = await aplicarExclusaoProduto(prisma, id);
    return NextResponse.json({ ok: true, modo: modo === "desativar" ? "desativado" : "excluido" });
  } catch (err) {
    console.error("[admin:produto:delete]", err);
    return NextResponse.json({ error: "Erro ao excluir" }, { status: 500 });
  }
}
