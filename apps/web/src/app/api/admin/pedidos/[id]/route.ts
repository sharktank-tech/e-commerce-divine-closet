import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { orderStatusLabel } from "@/lib/utils";

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
      },
      include: {
        items: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (order.user?.email) {
      await sendEmail({
        to: order.user.email,
        subject: `Pedido ${order.number} atualizado`,
        text: `Seu pedido ${order.number} agora está: ${orderStatusLabel(order.status)}.`,
      });
    }

    return NextResponse.json({ order });
  } catch (err) {
    console.error("[admin:pedido:patch]", err);
    return NextResponse.json({ error: "Erro ao atualizar" }, { status: 500 });
  }
}
