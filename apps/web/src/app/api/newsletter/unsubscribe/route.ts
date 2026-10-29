import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chaveIp, respostaLimite, verificarLimite } from "@/lib/rate-limit";

// GET: apenas apresenta a confirmação (não altera estado)
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  const subscriber = await prisma.newsletterSubscriber.findUnique({
    where: { unsubscribeToken: token },
  });

  if (!subscriber) {
    return NextResponse.json({ error: "Token inválido" }, { status: 404 });
  }

  return NextResponse.json({
    status: subscriber.status,
    message: subscriber.status === "unsubscribed"
      ? "E-mail já cancelado."
      : "Confirme o cancelamento da inscrição.",
  });
}

// POST: cancela a inscrição (idempotente)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = body?.token || req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  const limite = verificarLimite(`newsletter-unsubscribe:${token}`, { janelaMs: 60_000, maximo: 10 });
  if (!limite.permitido) return respostaLimite(limite.resetEmMs);

  const subscriber = await prisma.newsletterSubscriber.findUnique({
    where: { unsubscribeToken: token },
  });

  if (!subscriber) {
    return NextResponse.json({ error: "Token inválido" }, { status: 404 });
  }

  // Idempotente: se já cancelado, retorna sucesso sem alterar
  if (subscriber.status === "unsubscribed") {
    return NextResponse.json({ ok: true, message: "Inscrição já cancelada." });
  }

  // Cancelar
  await prisma.newsletterSubscriber.update({
    where: { id: subscriber.id },
    data: { status: "unsubscribed", unsubscribedAt: new Date() },
  });

  return NextResponse.json({ ok: true, message: "Inscrição cancelada com sucesso." });
}
