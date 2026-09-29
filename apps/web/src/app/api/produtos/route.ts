import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicProductCardSelect, toPublicCardProduct } from "@/lib/produto-publico";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q") || "";
    const category = searchParams.get("categoria") || "";
    // múltiplas categorias separadas por vírgula (ex.: item "Calças e Shorts" do menu)
    const categorySlugs = category
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(48, Number(searchParams.get("pageSize") || 12));
    const sort = searchParams.get("sort") || "recent";
    const precoMin = Number(searchParams.get("preco_min") || 0);
    const precoMax = Number(searchParams.get("preco_max") || 0);
    const soEstoque = searchParams.get("estoque") === "1";
    const soOferta = searchParams.get("oferta") === "1";
    // busca direta por ids (vistos recentemente, picker do admin).
    // Só UUIDs válidos: evita P2023 com strings arbitrárias.
    const ids = (searchParams.get("ids") || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
      .slice(0, 24);

    const price: { gte?: number; lte?: number } = {};
    if (precoMin > 0) price.gte = precoMin;
    if (precoMax > 0) price.lte = precoMax;

    const where = {
      isActive: true,
      deletedAt: null,
      ...(ids.length > 0 ? { id: { in: ids } } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
              { sku: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(categorySlugs.length > 0 ? { category: { slug: { in: categorySlugs } } } : {}),
      ...(Object.keys(price).length ? { price } : {}),
      ...(soEstoque ? { stock: { gt: 0 } } : {}),
      ...(soOferta ? { discountPercent: { gt: 0 } } : {}),
    };

    const orderBy =
      sort === "price_asc"
        ? { price: "asc" as const }
        : sort === "price_desc"
          ? { price: "desc" as const }
          : sort === "desconto"
            ? { discountPercent: "desc" as const }
            : sort === "sales"
            ? { orderItems: { _count: "desc" as const } }
            : sort === "name"
              ? { name: "asc" as const }
              : { createdAt: "desc" as const };

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: publicProductCardSelect,
      }),
    ]);

    // Allow-list pública + estado de estoque em vez do número exato.
    // A quantidade só vai junto quando baixa (urgência); o servidor valida os limites.
    const shaped = items.map(toPublicCardProduct);

    return NextResponse.json({
      items: shaped,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    });
  } catch (err) {
    console.error("[produtos:list]", err);
    return NextResponse.json({ error: "Erro ao carregar produtos" }, { status: 500 });
  }
}
