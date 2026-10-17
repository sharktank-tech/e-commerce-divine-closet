import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { emails, sendEmail } from "@/lib/email";
import { HORAS_ABANDONO, precisaLembrete } from "@/lib/carrinho-abandonado";
import { reconciliarPixPendentes } from "@/lib/reconciliar-pix";
import { drenarEventosErp } from "@/lib/erp";
import { drenarEmailsOutbox } from "@/lib/email-outbox";

// Lembrete de carrinho abandonado (só logados — guest não tem e-mail).
// Agendado via cron (vercel.json) com CRON_SECRET, mesma proteção da
// rota de convite de avaliação.
// Plano Hobby: cada cron roda no máx. 1x/dia (expressões mais frequentes
// falham no deploy). A reconciliação de Pix pendente (rede de segurança do
// webhook), o dreno da fila de eventos ERP e o dreno do outbox de e-mails
// rodam junto aqui, antes do lembrete (18h tem um 2º dreno em
// /api/cron/emails).
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization") || "";
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    let pix;
    try {
      pix = await reconciliarPixPendentes();
    } catch (err) {
      // não bloqueia o lembrete de carrinho
      console.error("[cron:carrinho:reconciliar-pix]", err);
      pix = { erro: true };
    }

    let erp;
    try {
      erp = await drenarEventosErp();
    } catch (err) {
      // não bloqueia o lembrete de carrinho
      console.error("[cron:carrinho:erp]", err);
      erp = { processados: 0, entregues: 0, erro: true };
    }

    let emailOutbox;
    try {
      emailOutbox = await drenarEmailsOutbox();
    } catch (err) {
      // não bloqueia o lembrete de carrinho
      console.error("[cron:carrinho:email-outbox]", err);
      emailOutbox = { processados: 0, enviados: 0, falhas: 0, erro: true };
    }

    const base = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
    const agora = new Date();
    const carrinhos = await prisma.cart.findMany({
      where: {
        userId: { not: null },
        lembradoEm: null,
        items: { some: {} },
      },
      include: {
        user: { select: { email: true, name: true } },
        items: {
          select: {
            quantity: true,
            createdAt: true,
            product: { select: { name: true } },
          },
        },
      },
      take: 200,
    });

    let enviados = 0;
    let pulados = 0;
    for (const carrinho of carrinhos) {
      const email = carrinho.user?.email;
      if (
        !email ||
        !precisaLembrete(
          carrinho.items.map((i) => i.createdAt),
          carrinho.lembradoEm,
          agora
        )
      ) {
        pulados++;
        continue;
      }
      try {
        const mail = emails.carrinhoAbandonado(
          carrinho.user?.name || "cliente",
          carrinho.items.map((i) => ({ name: i.product.name, quantity: i.quantity })),
          `${base}/carrinho`
        );
        await sendEmail({ to: email, subject: mail.subject, text: mail.text });
        enviados++;
      } catch (err) {
        console.error("[cron:carrinho:email]", carrinho.id, err);
        pulados++;
        continue;
      }
      await prisma.cart.update({
        where: { id: carrinho.id },
        data: { lembradoEm: new Date() },
      });
    }

    return NextResponse.json({ ok: true, pix, erp, emailOutbox, avaliados: carrinhos.length, enviados, pulados });
  } catch (err) {
    console.error("[cron:carrinho]", err);
    return NextResponse.json({ error: "Erro no lembrete" }, { status: 500 });
  }
}
