import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { emails, sendEmail } from "@/lib/email";

// Solicita link de redefinição — resposta sempre genérica (anti-enumeração).
const schema = z.object({
  email: z.string().email("Informe um e-mail válido"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const user = await prisma.user.findFirst({
      where: { email, deletedAt: null, active: true },
    });

    if (user) {
      const token = randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1h

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: token, passwordResetExpires: expires },
      });

      // base do link: domínio oficial via env, com fallback para a origem do request
      const base = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
      const link = `${base}/redefinir?token=${token}`;
      try {
        await sendEmail({ to: user.email, ...emails.passwordReset(link) });
      } catch (err) {
        console.error("[auth:recuperar:email]", err);
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Se o e-mail estiver cadastrado, você receberá o link de redefinição.",
    });
  } catch (err) {
    console.error("[auth:recuperar]", err);
    return NextResponse.json({ error: "Erro ao processar solicitação" }, { status: 500 });
  }
}
