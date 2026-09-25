import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q") || "";
    const category = searchParams.get("categoria") || "";
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(48, Number(searchParams.get("pageSize") || 12));
    const sort = searchParams.get("sort") || "recent";
    const precoMin = Number(searchParams.get("preco_min") || 0);
    const precoMax = Number(searchParams.get("preco_max") || 0);
    const soEstoque = searchParams.get("estoque") === "1";

    const price: { gte?: number; lte?: number } = {};
    if (precoMin > 0) price.gte = precoMin;
    if (precoMax > 0) price.lte = precoMax;

    const where = {
      isActive: true,
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
              { sku: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(category ? { category: { slug: category } } : {}),
      ...(Object.keys(price).length ? { price } : {}),
      ...(soEstoque ? { stock: { gt: 0 } } : {}),
    };

    const orderBy =
      sort === "price_asc"
        ? { price: "asc" as const }
        : sort === "price_desc"
          ? { price: "desc" as const }
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
        include: { category: true },
      }),
    ]);

    return NextResponse.json({
      items,
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
