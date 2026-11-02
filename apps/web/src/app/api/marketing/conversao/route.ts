import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { comErro } from "@/lib/erros";

export const POST = comErro(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const { number, email, checkoutKey } = body || {};

  if (!number) {
    return NextResponse.json({ error: "Número do pedido obrigatório" }, { status: 400 });
  }

  const session = await getSession(req);

  // Find order by number
  const order = await prisma.order.findUnique({
    where: { number },
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  // Authorization: session owner or guest with matching email or valid checkout key
  let authorized = false;
  if (session && order.userId === session.sub) {
    authorized = true;
  } else if (order.userId === null && order.guestEmail) {
    // Guest: need checkout key or matching email
    if (checkoutKey && order.idempotencyKey === checkoutKey) {
      authorized = true;
    } else if (email && order.guestEmail === email) {
      // Email alone is NOT sufficient authorization (security)
      // Only allow if there's a valid checkout key
      authorized = false;
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 404 });
  }

  // Hold code blocks conversion
  if (order.holdCode) {
    return NextResponse.json({ paid: false, total: Number(order.total) }, { status: 200 });
  }

  // Payment must be PAID
  if (order.paymentStatus !== "PAID") {
    return NextResponse.json({ paid: false, total: Number(order.total) }, { status: 200 });
  }

  // Check if order is too old (2 hours) — applies to guest/anonymous access
  // to prevent enumeration. Authenticated owners can always access their order.
  const isOwner = session && order.userId === session.sub;
  if (!isOwner) {
    const twoHoursAgo = new Date(Date.now() - 7_200_000);
    if (order.createdAt < twoHoursAgo) {
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    }
  }

  // Return paid status with server-confirmed total
  return NextResponse.json({
    paid: true,
    total: Number(order.total),
  });
});
