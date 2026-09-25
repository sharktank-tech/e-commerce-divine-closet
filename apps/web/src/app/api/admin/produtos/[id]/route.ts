import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

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
    sizes: z.array(z.string()).optional(),
    colors: z.array(z.string()).optional(),
    categoryId: z.string().min(1).optional(),
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

    const { variations, ...rest } = parsed.data;

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
    await prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin:produto:delete]", err);
    return NextResponse.json({ error: "Erro ao excluir" }, { status: 500 });
  }
}
