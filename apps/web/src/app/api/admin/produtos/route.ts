import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { slugify } from "@/lib/utils";
import { discountPercent } from "@/lib/precos";
import { normalizeImageMeta } from "@/lib/imagens";
import { calcularSnapshot } from "@/lib/precificacao-server";

const variationSchema = z.array(
  z.object({
    size: z.string().min(1),
    color: z.string().nullish(),
    stock: z.number().int().min(0),
    sku: z.string().nullish(),
  })
);

const productSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(2),
  price: z.number().positive(),
  comparePrice: z.number().positive().nullish(),
  sku: z.string().nullish(),
  stock: z.number().int().min(0),
  isActive: z.boolean().default(true),
  featured: z.boolean().default(false),
  images: z.array(z.string()).default([]),
  imageColors: z.array(z.string()).default([]),
  imageAlts: z.array(z.string()).default([]),
  sizes: z.array(z.string()).default([]),
  colors: z.array(z.string()).default([]),
  categoryId: z.string().min(1),
  slug: z.string().optional(),
  variations: variationSchema.optional(),
  tabelaMedidasId: z.string().nullish(),
  composicao: z.string().nullish(),
  instrucoesLavagem: z.string().nullish(),
  comprimento: z.string().nullish(),
  modeloAltura: z.string().nullish(),
  modeloVeste: z.string().nullish(),
  caimento: z.string().nullish(),
  ocasiao: z.string().nullish(),
  metaTitle: z.string().nullish(),
  metaDescription: z.string().nullish(),
  relacionados: z.array(z.string()).default([]),
  // Precificação (opcional): origem do custo + overrides. O servidor
  // recalcula e grava os snapshots; o preço de venda continua livre.
  loteId: z.string().nullish(),
  custoPecaManualCentavos: z.number().int().min(0).nullish(),
  markupProduto: z.number().int().min(0).max(1000).nullish(),
  custosExtrasCentavos: z.number().int().min(0).optional(),
  custosExtrasDescricao: z.string().max(200).nullish(),
});

export async function GET() {
  try {
    const products = await prisma.product.findMany({
      where: { deletedAt: null },
      include: { category: true, variations: { orderBy: { size: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ items: products });
  } catch (err) {
    console.error("[admin:produtos:list]", err);
    return NextResponse.json({ error: "Erro ao carregar produtos" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const body = await req.json();
    const parsed = productSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const slug = data.slug ? slugify(data.slug) : slugify(data.name);

    // Colisão de slug: avisa em vez de criar sufixo silencioso (SEO).
    // Inclui deletados: reutilizar slug de produto apagado exige restaurar ou renomear.
    const slugExists = await prisma.product.findUnique({ where: { slug } });
    if (slugExists) {
      return NextResponse.json(
        {
          error: `Já existe um produto com o slug "${slug}" (${slugExists.name}). Ajuste o nome ou informe outro slug.`,
        },
        { status: 409 }
      );
    }

    const variations = data.variations || [];
    const variationStock = variations.reduce((s, v) => s + v.stock, 0);

    // relacionados: mantém só ids existentes e ativos
    let relacionados: string[] = [];
    if (data.relacionados.length > 0) {
      const ids = data.relacionados.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
      const found = await prisma.product.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true },
      });
      relacionados = found.map((p) => p.id);
    }

    // Snapshot de precificação: só quando há origem de custo.
    // O preço de venda (data.price) nunca é alterado pelo cálculo.
    let snapshotData: Record<string, unknown> = {};
    if (data.loteId || data.custoPecaManualCentavos !== undefined) {
      const snap = await calcularSnapshot({
        loteId: data.loteId || null,
        custoPecaManualCentavos: data.custoPecaManualCentavos ?? null,
        markupProduto: data.markupProduto ?? null,
        custosExtrasCentavos: data.custosExtrasCentavos ?? 0,
        custosExtrasDescricao: data.custosExtrasDescricao || null,
      });
      if (snap) {
        snapshotData = {
          lote_id: data.loteId || null,
          custo_peca_centavos: snap.custoPeca,
          custo_embalagem_centavos: snap.custoEmbalagem,
          custos_extras_centavos: snap.custosExtras,
          custos_extras_descricao: data.custosExtrasDescricao || null,
          markup_percentual: data.markupProduto ?? null,
          preco_sugerido_centavos: snap.precoSugerido,
          precificacao_calculada_em: new Date(),
        };
      }
    }

    const product = await prisma.product.create({
      data: {
        name: data.name,
        slug,
        description: data.description,
        price: data.price,
        comparePrice: data.comparePrice ?? null,
        discountPercent: discountPercent(data.price, data.comparePrice ?? null),
        sku: data.sku || null,
        stock: variations.length > 0 ? variationStock : data.stock,
        isActive: data.isActive,
        featured: data.featured,
        images: data.images,
        ...(() => {
          const meta = normalizeImageMeta(data.images, data.imageColors, data.imageAlts);
          return { imageColors: meta.colors, imageAlts: meta.alts };
        })(),
        sizes: data.sizes,
        colors: data.colors,
        categoryId: data.categoryId,
        tabelaMedidasId: data.tabelaMedidasId || null,
        relacionados,
        composicao: data.composicao || null,
        instrucoesLavagem: data.instrucoesLavagem || null,
        comprimento: data.comprimento || null,
        modeloAltura: data.modeloAltura || null,
        modeloVeste: data.modeloVeste || null,
        caimento: data.caimento || null,
        ocasiao: data.ocasiao || null,
        metaTitle: data.metaTitle || null,
        metaDescription: data.metaDescription || null,
        // Snapshot de precificação (quando origem de custo informada).
        ...snapshotData,
        ...(variations.length > 0
          ? {
              variations: {
                create: variations.map((v) => ({
                  size: v.size,
                  color: v.color || null,
                  stock: v.stock,
                  sku: v.sku || null,
                })),
              },
            }
          : {}),
      },
      include: { category: true, variations: true },
    });

    return NextResponse.json({ product }, { status: 201 });
  } catch (err) {
    console.error("[admin:produtos:create]", err);
    return NextResponse.json({ error: "Erro ao criar produto" }, { status: 500 });
  }
}
