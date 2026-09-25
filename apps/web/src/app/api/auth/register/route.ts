import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, setSession } from "@/lib/auth";
import { emails, sendEmail } from "@/lib/email";

const schema = z.object({
  name: z.string().min(2, "Nome muito curto"),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
  phone: z.string().optional(),
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

    const { name, email, password, phone } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
    }

    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: await hashPassword(password),
        phone: phone || null,
        role: "CLIENT",
      },
    });

    await setSession({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: "CLIENT",
    });

    const mail = emails.welcome(user.name);
    await sendEmail({ to: user.email, subject: mail.subject, text: mail.text });

    return NextResponse.json(
      { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
      { status: 201 }
    );
  } catch (err) {
    console.error("[register]", err);
    return NextResponse.json({ error: "Erro ao criar conta" }, { status: 500 });
  }
}
