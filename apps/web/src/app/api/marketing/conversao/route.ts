import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  formatoTokenValido,
  hashToken,
  tokenAtivo,
} from "@/lib/pedidos/acompanhar";
import { consumirRateLimit, ipDoPedido } from "@/lib/rate-limit";
import { createHash } from "crypto";
export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  const missing = () =>
    NextResponse.json(
      { error: "Pedido indisponível." },
      { status: 404, headers },
    );
  const key = createHash("sha256")
    .update(ipDoPedido(req.headers))
    .digest("hex");
  if (
    !(
      await consumirRateLimit(`conversion:${key}`, { limite: 30, janelaMin: 1 })
    ).permitido
  )
    return NextResponse.json({ error: "Aguarde." }, { status: 429, headers });
  const body = await req.json().catch(() => null);
  if (typeof body?.number !== "string" || body.number.length > 64)
    return missing();
  const session = await getSession(req);
  let guestOrder: string | undefined;
  if (formatoTokenValido(body.trackingToken)) {
    const row = await prisma.orderTrackToken.findUnique({
      where: { tokenHash: hashToken(body.trackingToken) },
    });
    if (row && tokenAtivo(row)) guestOrder = row.orderId;
  }
  const checkoutKey =
    typeof body.checkoutKey === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      body.checkoutKey,
    )
      ? body.checkoutKey
      : undefined;
  if (!session && !guestOrder && !checkoutKey) return missing();
  const o = await prisma.order.findFirst({
    where: {
      number: body.number,
      deletedAt: null,
      OR: [
        ...(session ? [{ userId: session.sub }] : []),
        ...(guestOrder ? [{ id: guestOrder, userId: null }] : []),
        ...(!session && checkoutKey
          ? [
              {
                idempotencyKey: checkoutKey,
                userId: null,
                createdAt: { gte: new Date(Date.now() - 3_600_000) },
              },
            ]
          : []),
      ],
    },
    include: { items: true },
  });
  if (!o) return missing();
  if (
    o.paymentStatus !== "PAID" ||
    o.holdCode ||
    ["CANCELLED", "REFUNDED", "PENDING"].includes(o.status)
  )
    return NextResponse.json({ paid: false }, { headers });
  return NextResponse.json(
    {
      paid: true,
      id: o.id,
      total: Number(o.total),
      items: o.items.map((i) => ({
        id: i.productId,
        name: i.productName,
        price: Number(i.unitPrice),
        quantity: i.quantity,
      })),
    },
    { headers },
  );
}
