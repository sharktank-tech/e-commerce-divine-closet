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

  // Não revelar detalhes do assinante
  return NextResponse.json({
    status: subscriber.status,
    message: subscriber.status === "confirmed"
      ? "E-mail já confirmado."
      : subscriber.status === "unsubscribed"
      ? "E-mail cancelado."
      : "Confirme seu e-mail para receber nossas novidades.",
  });
}

// POST: confirma a inscrição
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = body?.token || req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  const limite = verificarLimite(`newsletter-confirm:${token}`, { janelaMs: 60_000, maximo: 10 });
  if (!limite.permitido) return respostaLimite(limite.resetEmMs);

  const subscriber = await prisma.newsletterSubscriber.findUnique({
    where: { unsubscribeToken: token },
  });

  if (!subscriber) {
    return NextResponse.json({ error: "Token inválido" }, { status: 404 });
  }

  if (subscriber.status === "confirmed") {
    return NextResponse.json({ ok: true, message: "E-mail já confirmado." });
  }

  if (subscriber.status === "unsubscribed") {
    return NextResponse.json({ ok: false, message: "E-mail cancelado. Reative explicitamente." }, { status: 409 });
  }

  // Confirmar
  await prisma.newsletterSubscriber.update({
    where: { id: subscriber.id },
    data: { status: "confirmed", confirmedAt: new Date() },
  });

  return NextResponse.json({ ok: true, message: "E-mail confirmado com sucesso." });
}
