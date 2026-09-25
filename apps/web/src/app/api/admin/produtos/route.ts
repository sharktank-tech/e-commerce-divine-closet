import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { slugify } from "@/lib/utils";

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
  sizes: z.array(z.string()).default([]),
  colors: z.array(z.string()).default([]),
  categoryId: z.string().min(1),
  slug: z.string().optional(),
  variations: variationSchema.optional(),
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
    let slug = data.slug ? slugify(data.slug) : slugify(data.name);

    const slugExists = await prisma.product.findUnique({ where: { slug } });
    if (slugExists) slug = `${slug}-${Date.now().toString(36)}`;

    const variations = data.variations || [];
    const variationStock = variations.reduce((s, v) => s + v.stock, 0);

    const product = await prisma.product.create({
      data: {
        name: data.name,
        slug,
        description: data.description,
        price: data.price,
        comparePrice: data.comparePrice ?? null,
        sku: data.sku || null,
        stock: variations.length > 0 ? variationStock : data.stock,
        isActive: data.isActive,
        featured: data.featured,
        images: data.images,
        sizes: data.sizes,
        colors: data.colors,
        categoryId: data.categoryId,
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
