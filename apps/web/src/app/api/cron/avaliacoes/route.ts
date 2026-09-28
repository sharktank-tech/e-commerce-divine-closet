import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { emails, sendEmail } from "@/lib/email";

// Convite de avaliação X dias após a entrega (padrão 7).
// Agendado via cron (vercel.json) com CRON_SECRET. Sem WhatsApp
// (integração inexistente) — só e-mail, atrás do driver configurado.
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization") || "";
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const days = Math.max(1, Number(process.env.REVIEW_REQUEST_DAYS || 7));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const orders = await prisma.order.findMany({
      where: {
        status: "DELIVERED",
        entregueEm: { lte: cutoff },
        reviewRequestedAt: null,
        deletedAt: null,
        userId: { not: null },
      },
      include: {
        user: { select: { email: true, name: true } },
        items: {
          select: {
            productId: true,
            productName: true,
            productSlug: true,
          },
        },
      },
      take: 50,
    });

    const base = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
    let sent = 0;
    let skipped = 0;

    for (const order of orders) {
      const email = order.user?.email;
      if (!email) {
        skipped++;
        continue;
      }
      const items = order.items.map((i) => ({
        name: i.productName,
        url: `${base}/produtos/${i.productSlug}`,
      }));
      try {
        await sendEmail({ to: email, ...emails.reviewRequest(order.number, items) });
        sent++;
      } catch (err) {
        console.error("[cron:avaliacoes:email]", order.number, err);
        skipped++;
        continue;
      }
      await prisma.order.update({
        where: { id: order.id },
        data: { reviewRequestedAt: new Date() },
      });
    }

    return NextResponse.json({ ok: true, avaliados: orders.length, enviados: sent, pulados: skipped });
  } catch (err) {
    console.error("[cron:avaliacoes]", err);
    return NextResponse.json({ error: "Erro no job" }, { status: 500 });
  }
}
