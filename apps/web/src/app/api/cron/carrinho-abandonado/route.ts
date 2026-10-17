import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { emails, sendEmail } from "@/lib/email";
import { HORAS_ABANDONO, precisaLembrete } from "@/lib/carrinho-abandonado";
import { reconciliarPixPendentes } from "@/lib/reconciliar-pix";

// Lembrete de carrinho abandonado (só logados — guest não tem e-mail).
// Agendado via cron (vercel.json) com CRON_SECRET, mesma proteção da
// rota de convite de avaliação.
// Plano Hobby: no máximo 2 crons/dia — a reconciliação de Pix pendente
// (rede de segurança do webhook) roda junto aqui, antes do lembrete.
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

    return NextResponse.json({ ok: true, pix, avaliados: carrinhos.length, enviados, pulados });
  } catch (err) {
    console.error("[cron:carrinho]", err);
    return NextResponse.json({ error: "Erro no lembrete" }, { status: 500 });
  }
}
