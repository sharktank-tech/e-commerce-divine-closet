import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validarEmail } from "@/lib/validacao";
import { chaveIp, respostaLimite, verificarLimite } from "@/lib/rate-limit";
import { randomUUID } from "crypto";

const schema = z.object({
  email: z.string().email("E-mail inválido").refine((v) => validarEmail(v) === "OK", "E-mail inválido"),
  consentVersion: z.string().min(1).max(32),
  consentSource: z.string().min(1).max(64),
  consentedAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Dados inválidos" },
      { status: 400 }
    );
  }

  // Rate limit: 5 cadastros por hora por IP
  const limite = verificarLimite(chaveIp(req, "newsletter-subscribe"), {
    janelaMs: 3_600_000,
    maximo: 5,
  });
  if (!limite.permitido) return respostaLimite(limite.resetEmMs);

  const email = parsed.data.email.toLowerCase().trim();
  const now = new Date();

  // Verificar se já existe
  const existente = await prisma.newsletterSubscriber.findUnique({
    where: { email },
  });

  if (existente) {
    // Não revelar se está inscrito ou não (anti-enumeração)
    // Repetir cadastro não reativa cancelamento
    if (existente.status === "unsubscribed") {
      // Não reativa; retorna mensagem genérica
      return NextResponse.json(
        { ok: true, message: "Se o e-mail estiver elegível, você receberá uma confirmação." },
        { status: 200 }
      );
    }
    // Já existe e está pending ou confirmed: retorna mensagem genérica
    return NextResponse.json(
      { ok: true, message: "Se o e-mail estiver elegível, você receberá uma confirmação." },
      { status: 200 }
    );
  }

  // Criar novo assinante (status pending, aguardando confirmação)
  const token = randomUUID();
  await prisma.newsletterSubscriber.create({
    data: {
      email,
      status: "pending",
      consentVersion: parsed.data.consentVersion,
      consentSource: parsed.data.consentSource,
      consentedAt: parsed.data.consentedAt ? new Date(parsed.data.consentedAt) : now,
      unsubscribeToken: token,
    },
  });

  // Simular envio de confirmação (não enviar e-mail real em testes)
  // Em produção, chamaria sendEmail com o link de confirmação

  return NextResponse.json(
    { ok: true, message: "Se o e-mail estiver elegível, você receberá uma confirmação." },
    { status: 200 }
  );
}
