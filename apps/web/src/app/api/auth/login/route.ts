import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { setSession, verifyPassword } from "@/lib/auth";
import { chaveIp, respostaLimite, verificarLimite } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Informe a senha"),
  asAdmin: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    // 5 tentativas/min por IP contra força bruta.
    const limite = verificarLimite(chaveIp(req, "login"), { janelaMs: 60_000, maximo: 5 });
    if (!limite.permitido) return respostaLimite(limite.resetEmMs);

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const { email, password, asAdmin } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || user.deletedAt || !(await verifyPassword(password, user.password))) {
      return NextResponse.json({ error: "E-mail ou senha incorretos" }, { status: 401 });
    }

    if (!user.active) {
      return NextResponse.json({ error: "Conta desativada" }, { status: 403 });
    }

    if (asAdmin && user.role === "CLIENT") {
      return NextResponse.json({ error: "Acesso restrito ao painel" }, { status: 403 });
    }

    if (user.deletedAt) {
      return NextResponse.json({ error: "Conta desativada" }, { status: 403 });
    }

    await setSession({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    return NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("[login]", err);
    return NextResponse.json({ error: "Erro ao entrar" }, { status: 500 });
  }
}
