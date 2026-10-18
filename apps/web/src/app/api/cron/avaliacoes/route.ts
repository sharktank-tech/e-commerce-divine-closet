import { NextRequest, NextResponse } from "next/server";
import { autorizarCron } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { emails } from "@/lib/email";
import { enfileirarEmail, processarEmailOutbox } from "@/lib/email-outbox";

// Convite de avaliação X dias após a entrega (padrão 7).
// Agendado via cron (vercel.json) com CRON_SECRET. Sem WhatsApp
// (integração inexistente) — só e-mail, atrás do driver configurado.
// Fuso: "0 13 * * *" UTC = 10:00 em Araguaina (UTC−3).
//
// OUTBOX (fecha a lacuna de duplicidade): o convite era enviado DIRETO e o
// marcador reviewRequestedAt só era gravado DEPOIS do envio — se o envio
// fosse aceito mas a gravação falhasse (ou dois crons rodassem juntos), o
// próximo ciclo reenviava. Agora: enfileira com dedupeKey única
// (review:{orderId}) ANTES de qualquer envio — a unique impede a 2ª linha
// mesmo sob concorrência —, tenta o envio imediato e grava o marcador. Falha
// de envio fica PENDING e o cron de dreno retenta; aceitação pelo provedor é
// o que marca SENT (nunca o agendamento).
export async function GET(req: NextRequest) {
  try {
    if (!autorizarCron(req.headers.get("authorization"), process.env.CRON_SECRET)) {
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
        const mail = emails.reviewRequest(order.number, items);
        // Enfileira idempotente (dedupeKey única) — repetição/concorrência não
        // gera 2ª linha; então tenta o envio e grava o marcador.
        const outboxId = await enfileirarEmail({
          dedupeKey: `review:${order.id}`,
          kind: "review_invite",
          orderId: order.id,
          mail: { to: email, subject: mail.subject, text: mail.text, html: mail.html },
        });
        if (!outboxId) {
          skipped++;
          continue;
        }
        await processarEmailOutbox(outboxId); // falha → PENDING, dreno retenta
        await prisma.order.update({
          where: { id: order.id },
          data: { reviewRequestedAt: new Date() },
        });
        sent++;
      } catch (err) {
        console.error("[cron:avaliacoes:email]", order.number, err);
        skipped++;
        continue;
      }
    }

    return NextResponse.json({ ok: true, avaliados: orders.length, enviados: sent, pulados: skipped });
  } catch (err) {
    console.error("[cron:avaliacoes]", err);
    return NextResponse.json({ error: "Erro no job" }, { status: 500 });
  }
}
