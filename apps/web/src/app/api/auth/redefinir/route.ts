import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

const schema = z.object({
  token: z.string().min(10, "Link inválido"),
  password: z.string().min(6, "Nova senha deve ter ao menos 6 caracteres"),
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

    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: parsed.data.token,
        passwordResetExpires: { gt: new Date() },
        deletedAt: null,
        active: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Link inválido ou expirado. Solicite um novo." },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await hashPassword(parsed.data.password),
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth:redefinir]", err);
    return NextResponse.json({ error: "Erro ao redefinir senha" }, { status: 500 });
  }
}
