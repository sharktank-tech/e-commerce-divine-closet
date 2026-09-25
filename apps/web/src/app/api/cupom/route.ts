import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/utils";
import { shipping as shippingConfig } from "@/config/defaults";

/**
 * Aplica cupom no carrinho do usuário/convidado.
 * TODO-CLIENTE: campanhas reais de cupom via admin.
 */
export async function POST(req: NextRequest) {
  try {
    const { code, subtotal } = (await req.json()) as {
      code?: string;
      subtotal?: number;
    };

    if (!code?.trim()) {
      return NextResponse.json({ error: "Informe o código do cupom" }, { status: 400 });
    }

    const coupon = await prisma.coupon.findUnique({
      where: { code: code.trim().toUpperCase() },
    });

    const now = new Date();
    if (
      !coupon ||
      !coupon.active ||
      coupon.deletedAt ||
      (coupon.startsAt && coupon.startsAt > now) ||
      (coupon.endsAt && coupon.endsAt < now) ||
      (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses)
    ) {
      return NextResponse.json({ error: "Cupom inválido ou expirado" }, { status: 404 });
    }

    const sub = Number(subtotal || 0);
    if (coupon.minSubtotal && sub < toNumber(coupon.minSubtotal)) {
      return NextResponse.json(
        {
          error: `Cupom exige pedido mínimo de R$ ${toNumber(coupon.minSubtotal).toFixed(2)}`,
        },
        { status: 400 }
      );
    }

    let discount = 0;
    let freeShipping = false;

    if (coupon.type === "PERCENT") {
      discount = (sub * toNumber(coupon.value)) / 100;
    } else if (coupon.type === "FIXED") {
      discount = Math.min(sub, toNumber(coupon.value));
    } else if (coupon.type === "FREE_SHIPPING") {
      freeShipping = true;
    }

    const shippingCost =
      freeShipping || sub >= shippingConfig.freeFrom ? 0 : shippingConfig.fixed;

    return NextResponse.json({
      coupon: {
        code: coupon.code,
        type: coupon.type,
        value: toNumber(coupon.value),
      },
      discount: Math.round(discount * 100) / 100,
      freeShipping,
      shipping: shippingCost,
    });
  } catch (err) {
    console.error("[cupom]", err);
    return NextResponse.json({ error: "Erro ao validar cupom" }, { status: 500 });
  }
}
