import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { cookies } from "next/headers";

const GUEST_COOKIE = "dc_guest";

async function getGuestId(req: NextRequest): Promise<string> {
  const store = await cookies();
  let guestId = req.cookies.get(GUEST_COOKIE)?.value || store.get(GUEST_COOKIE)?.value;
  if (!guestId) {
    guestId = crypto.randomUUID();
    store.set(GUEST_COOKIE, guestId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return guestId;
}

async function resolveCartId(req: NextRequest): Promise<{ cartId: string; userId: string | null }> {
  const session = await getSession(req);
  const guestId = await getGuestId(req);

  if (session) {
    let cart = await prisma.cart.findUnique({ where: { userId: session.sub } });
    if (!cart) cart = await prisma.cart.create({ data: { userId: session.sub } });
    return { cartId: cart.id, userId: session.sub };
  }

  let cart = await prisma.cart.findUnique({ where: { guestId } });
  if (!cart) cart = await prisma.cart.create({ data: { guestId } });
  return { cartId: cart.id, userId: null };
}

const itemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
  size: z.string().nullish(),
  color: z.string().nullish(),
});

export async function GET(req: NextRequest) {
  try {
    const { cartId } = await resolveCartId(req);
    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: { product: { include: { category: true } } },
          orderBy: { id: "asc" },
        },
      },
    });

    const items = (cart?.items || []).map((i) => ({
      id: i.id,
      quantity: i.quantity,
      size: i.size,
      color: i.color,
      product: {
        id: i.product.id,
        name: i.product.name,
        slug: i.product.slug,
        price: i.product.price,
        stock: i.product.stock,
        images: i.product.images,
        category: i.product.category.name,
      },
      lineTotal: Number(i.product.price) * i.quantity,
    }));

    const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);

    return NextResponse.json({ items, subtotal, count: items.reduce((s, i) => s + i.quantity, 0) });
  } catch (err) {
    console.error("[carrinho:get]", err);
    return NextResponse.json({ error: "Erro ao carregar carrinho" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = itemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Item inválido" }, { status: 400 });
    }

    const { cartId } = await resolveCartId(req);
    const { productId, quantity, size, color } = parsed.data;

    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
    });
    if (!product || !product.isActive) {
      return NextResponse.json({ error: "Produto indisponível" }, { status: 404 });
    }
    if (product.stock < quantity) {
      return NextResponse.json({ error: "Estoque insuficiente" }, { status: 409 });
    }

    // estoque por variação (tamanho/cor) — seção 4.3
    const variations = await prisma.productVariation.findMany({
      where: { productId: product.id },
    });
    let variation: { id: string; stock: number } | null = null;
    if (variations.length > 0) {
      const bySize = variations.filter((v) => v.size === size);
      const exact = bySize.find((v) => (v.color ?? null) === (color ?? null));
      if (exact) {
        variation = exact;
      } else if (!color && bySize.length === 1) {
        variation = bySize[0];
      } else if (bySize.length === 0) {
        return NextResponse.json({ error: "Selecione o tamanho desta combinação" }, { status: 409 });
      } else {
        return NextResponse.json({ error: "Combinação indisponível" }, { status: 409 });
      }
    }

    const existing = await prisma.cartItem.findFirst({
      where: {
        cartId,
        productId,
        size: size ?? null,
        color: color ?? null,
      },
    });

    if (variation) {
      const base = existing?.quantity ?? 0;
      if (base + quantity > variation.stock) {
        return NextResponse.json(
          { error: "Estoque insuficiente para esta combinação" },
          { status: 409 }
        );
      }
    }

    if (existing) {
      await prisma.cartItem.update({
        where: { id: existing.id },
        data: {
          quantity: Math.min(99, variation ? variation.stock : 99, existing.quantity + quantity),
        },
      });
    } else {
      await prisma.cartItem.create({
        data: { cartId, productId, quantity, size: size ?? null, color: color ?? null },
      });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[carrinho:add]", err);
    return NextResponse.json({ error: "Erro ao adicionar item" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { itemId, quantity } = body as { itemId?: string; quantity?: number };
    if (!itemId || typeof quantity !== "number") {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const { cartId } = await resolveCartId(req);
    const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId } });
    if (!item) return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });

    if (quantity <= 0) {
      await prisma.cartItem.delete({ where: { id: item.id } });
    } else {
      await prisma.cartItem.update({
        where: { id: item.id },
        data: { quantity: Math.min(99, quantity) },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[carrinho:patch]", err);
    return NextResponse.json({ error: "Erro ao atualizar carrinho" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { cartId } = await resolveCartId(req);
    const { searchParams } = req.nextUrl;
    const itemId = searchParams.get("itemId");

    if (itemId) {
      await prisma.cartItem.deleteMany({ where: { id: itemId, cartId } });
    } else {
      await prisma.cartItem.deleteMany({ where: { cartId } });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[carrinho:delete]", err);
    return NextResponse.json({ error: "Erro ao limpar carrinho" }, { status: 500 });
  }
}
