import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { orderStatusLabel } from "@/lib/utils";
import { validarUrlRastreio } from "@/lib/rastreio";

const schema = z.object({
  status: z.enum([
    "PENDING",
    "PAID",
    "PROCESSING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
    "REFUNDED",
  ]),
  paymentStatus: z.enum(["PENDING", "PAID", "FAILED", "REFUNDED"]).optional(),
  trackingCode: z.string().nullish(),
  trackingCarrier: z.string().trim().max(80).nullish(),
  // Link externo de rastreio: validado no servidor (HTTPS + allowlist);
  // URL fora da regra é gravada como null (nunca exibida ao cliente).
  trackingUrl: z.string().trim().max(2048).nullish(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        refund: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
        address: true,
      },
    });

    if (!order) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json({ order });
  } catch (err) {
    console.error("[admin:pedido:get]", err);
    return NextResponse.json({ error: "Erro ao carregar" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Status inválido" }, { status: 400 });
    }

    const order = await prisma.order.update({
      where: { id },
      data: {
        status: parsed.data.status,
        ...(parsed.data.paymentStatus ? { paymentStatus: parsed.data.paymentStatus } : {}),
        ...(parsed.data.trackingCode !== undefined
          ? { trackingCode: parsed.data.trackingCode || null }
          : {}),
        ...(parsed.data.trackingCarrier !== undefined
          ? { trackingCarrier: parsed.data.trackingCarrier || null }
          : {}),
        ...(parsed.data.trackingUrl !== undefined
          ? { trackingUrl: parsed.data.trackingUrl ? validarUrlRastreio(parsed.data.trackingUrl) : null }
          : {}),
        // marca a entrega (base do convite de avaliação pós-compra)
        ...(parsed.data.status === "DELIVERED" ? { entregueEm: new Date() } : {}),
      },
      include: {
        items: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (order.user?.email) {
      // notificação não bloqueia a atualização do pedido
      sendEmail({
        to: order.user.email,
        subject: `Pedido ${order.number} atualizado`,
        text: `Seu pedido ${order.number} agora está: ${orderStatusLabel(order.status)}.`,
      }).catch((err) => console.error("[admin:pedido:email]", err));
    }

    return NextResponse.json({ order });
  } catch (err) {
    console.error("[admin:pedido:patch]", err);
    return NextResponse.json({ error: "Erro ao atualizar" }, { status: 500 });
  }
}
