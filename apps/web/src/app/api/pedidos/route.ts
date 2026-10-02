import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { processPayment } from "@/lib/pagamento";
import { sendEmail, emails } from "@/lib/email";
import { orderNumber, formatBRL } from "@/lib/utils";
import { reaisParaCentavos } from "@/lib/carrinho-revalidacao";
import {
  calcularPedido,
  calcularTotalCentavos,
  centavosParaReais,
} from "@/lib/pedidos/calculo-total";
import { elegibilidadeCupom } from "@/lib/elegibilidade-cupom";
import { enderecoSchema, validarEmail, validarNome } from "@/lib/validacao";
import { shipping as shippingConfig } from "@/config/defaults";
import { cookies } from "next/headers";

const checkoutSchema = z.object({
  address: enderecoSchema.extend({ label: z.string().optional() }),
  payment: z.object({
    method: z.enum(["card", "pix", "boleto"]).default("card"),
    card: z
      .object({
        number: z.string().optional(),
        name: z.string().optional(),
        expiry: z.string().optional(),
        cvv: z.string().optional(),
      })
      .optional(),
  }),
  couponCode: z.string().nullish(),
  notes: z.string().nullish(),
  guest: z
    .object({
      email: z
        .string()
        .email("E-mail do convidado inválido")
        .refine((v) => validarEmail(v) === "OK", "E-mail do convidado inválido"),
      name: z
        .string()
        .min(2)
        .optional()
        .refine((v) => v == null || validarNome(v) === "OK", "Nome inválido"),
    })
    .optional(),
  utm: z
    .object({
      source: z.string().nullish(),
      medium: z.string().nullish(),
      campaign: z.string().nullish(),
    })
    .optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const orders = await prisma.order.findMany({
      where: { userId: session.sub },
      include: { items: true, address: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ orders });
  } catch (err) {
    console.error("[pedidos:list]", err);
    return NextResponse.json({ error: "Erro ao carregar pedidos" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Compra como convidado é permitida: sessão opcional.
    const session = await getSession(req);

    const body = await req.json();
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    if (!session && !parsed.data.guest?.email) {
      return NextResponse.json(
        { error: "Informe seu e-mail para continuar como convidado ou faça login" },
        { status: 401 }
      );
    }

    const guestEmail = session ? null : parsed.data.guest!.email;
    const guestName = session ? session.name : parsed.data.guest!.name || null;

    const guestId = req.cookies.get("dc_guest")?.value;
    const cartWhere: Array<{ userId?: string; guestId?: string }> = [];
    if (session) cartWhere.push({ userId: session.sub });
    if (guestId) cartWhere.push({ guestId });

    const cart = cartWhere.length
      ? await prisma.cart.findFirst({
          where: { OR: cartWhere },
          include: {
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    price: true,
                    stock: true,
                    isActive: true,
                    images: true,
                  },
                },
              },
            },
          },
        })
      : null;

    if (!cart || cart.items.length === 0) {
      return NextResponse.json({ error: "Carrinho vazio" }, { status: 400 });
    }

    // Revalidação final: preço/ disponibilidade podem ter mudado entre a
    // adição ao carrinho e o checkout. Nada é cobrado silenciosamente —
    // o cliente resolve no checkout (aceitar novo preço ou remover o item).
    const bloqueios: Array<{ itemId: string; name: string; motivo: string }> = [];
    for (const item of cart.items) {
      if (!item.product.isActive) {
        bloqueios.push({ itemId: item.id, name: item.product.name, motivo: "indisponivel" });
        continue;
      }
      if (reaisParaCentavos(item.unitPrice) !== reaisParaCentavos(item.product.price)) {
        bloqueios.push({ itemId: item.id, name: item.product.name, motivo: "preco" });
      }
    }
    if (bloqueios.length > 0) {
      return NextResponse.json(
        { error: "Revise os avisos do carrinho antes de finalizar", bloqueios },
        { status: 409 }
      );
    }

    for (const item of cart.items) {
      if (item.product.stock < item.quantity) {
        return NextResponse.json(
          { error: `Estoque insuficiente para ${item.product.name}` },
          { status: 409 }
        );
      }
      // valida estoque por variação (tamanho/cor) — seção 4.3
      const vars = await prisma.productVariation.findMany({
        where: { productId: item.product.id },
      });
      if (vars.length > 0) {
        const bySize = vars.filter((v) => v.size === item.size);
        const exact = bySize.find((v) => (v.color ?? null) === (item.color ?? null));
        const match = exact ?? (!item.color && bySize.length === 1 ? bySize[0] : undefined);
        if (!match) {
          return NextResponse.json(
            { error: `Combinação indisponível para ${item.product.name}` },
            { status: 409 }
          );
        }
        if (match.stock < item.quantity) {
          return NextResponse.json(
            { error: `Estoque insuficiente para ${item.product.name}` },
            { status: 409 }
          );
        }
      }
    }

    const subtotal = cart.items.reduce(
      (s, i) => s + Number(i.product.price) * i.quantity,
      0
    );
    const subtotalCentavos = reaisParaCentavos(subtotal);

    const { address: addr, payment, notes, couponCode, utm } = parsed.data;
    const methodMap = { card: "CARD", pix: "PIX", boleto: "BOLETO" } as const;
    const paymentMethod = methodMap[payment.method] || "CARD";

    // Cupom — revalidado no servidor. Cálculo único em
    // lib/pedidos/calculo-total.ts — mesmo módulo que /api/cupom usa
    // para exibir, para gravado e exibido coincidirem até o centavo.
    const appliedCouponCode = couponCode?.trim().toUpperCase() || null;
    let cupomValido: { type: "PERCENT" | "FIXED" | "FREE_SHIPPING"; value: unknown } | null = null;

    if (appliedCouponCode) {
      const coupon = await prisma.coupon.findUnique({
        where: { code: appliedCouponCode },
      });
      const now = new Date();
      // Mesma regra de /api/cupom (lib/elegibilidade-cupom.ts); aqui
      // qualquer motivo vira 400 com a mensagem única desta rota.
      const eleg = elegibilidadeCupom(coupon, now, subtotal);
      if (!coupon || !eleg.elegivel) {
        return NextResponse.json({ error: "Cupom inválido" }, { status: 400 });
      }
      cupomValido = { type: coupon.type, value: coupon.value };
    }

    const { descontoCentavos, freteCentavos } = calcularPedido(
      subtotalCentavos,
      cupomValido,
      shippingConfig
    );
    // TODO-CLIENTE: tabela de frete real da transportadora
    const discount = centavosParaReais(descontoCentavos);
    const shipping = centavosParaReais(freteCentavos);
    const total = centavosParaReais(
      calcularTotalCentavos(subtotalCentavos, descontoCentavos, freteCentavos)
    );

    const address = await prisma.address.create({
      data: {
        userId: session?.sub || null,
        label: addr.label || "Principal",
        street: addr.street,
        number: addr.number,
        complement: addr.complement || null,
        neighborhood: addr.neighborhood,
        city: addr.city,
        state: addr.state.toUpperCase(),
        zipCode: addr.zipCode,
      },
    });

    const order = await prisma.order.create({
      data: {
        number: orderNumber(),
        userId: session?.sub || null,
        guestEmail,
        guestName,
        addressId: address.id,
        status: "PENDING",
        paymentStatus: "PENDING",
        paymentMethod,
        couponCode: appliedCouponCode,
        subtotal: centavosParaReais(subtotalCentavos),
        shipping,
        discount,
        total,
        notes: notes || null,
        utmSource: utm?.source || null,
        utmMedium: utm?.medium || null,
        utmCampaign: utm?.campaign || null,
        items: {
          create: cart.items.map((i) => ({
            productId: i.product.id,
            productName: i.product.name,
            productSlug: i.product.slug,
            imageUrl: i.product.images[0] || null,
            size: i.size,
            color: i.color,
            quantity: i.quantity,
            unitPrice: i.product.price,
            total: Number(i.product.price) * i.quantity,
          })),
        },
      },
      include: { items: true },
    });

    const result = await processPayment({
      orderId: order.id,
      amount: total,
      method: payment.method || "card",
      card: payment.card,
    });

    if (result.success) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paymentStatus: "PAID",
          paymentId: result.paymentId,
        },
      });

      if (appliedCouponCode) {
        await prisma.coupon.update({
          where: { code: appliedCouponCode },
          data: { usedCount: { increment: 1 } },
        });
      }

      for (const item of cart.items) {
        await prisma.product.update({
          where: { id: item.product.id },
          data: { stock: { decrement: item.quantity } },
        });
        // baixa também o estoque da variação correspondente
        const vars = await prisma.productVariation.findMany({
          where: { productId: item.product.id },
        });
        if (vars.length > 0) {
          const bySize = vars.filter((v) => v.size === item.size);
          const exact = bySize.find((v) => (v.color ?? null) === (item.color ?? null));
          const match = exact ?? (!item.color && bySize.length === 1 ? bySize[0] : undefined);
          if (match) {
            await prisma.productVariation.update({
              where: { id: match.id },
              data: { stock: { decrement: item.quantity } },
            });
          }
        }
      }

      const mail = emails.orderPaid(order.number);
      // confirmação por e-mail não bloqueia o pedido
      sendEmail({
        to: session?.email || guestEmail || "",
        subject: mail.subject,
        text: mail.text,
      }).catch((err) => console.error("[pedidos:email]", err));
    } else {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "CANCELLED",
          paymentStatus: "FAILED",
          paymentId: result.paymentId,
        },
      });
    }

    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    const store = await cookies();
    store.delete("dc_guest");

    const finalOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true, address: true },
    });

    if (result.success) {
      return NextResponse.json(
        { order: finalOrder, payment: result, ok: true },
        { status: 201 }
      );
    }

    return NextResponse.json(
      { order: finalOrder, payment: result, ok: false, error: result.message },
      { status: 402 }
    );
  } catch (err) {
    console.error("[pedidos:create]", err);
    return NextResponse.json({ error: "Erro ao finalizar pedido" }, { status: 500 });
  }
}
