import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { clearSession, getSession, hashPassword, verifyPassword } from "@/lib/auth";
import { validarNome, validarTelefone } from "@/lib/validacao";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  // Dados frescos (telefone etc.) — a sessão JWT pode estar defasada.
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { name: true, email: true, phone: true, role: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({
    user: { ...session, name: user.name, email: user.email, phone: user.phone || "" },
  });
}

const schema = z.object({
  name: z
    .string()
    .min(2)
    .optional()
    .refine((v) => v == null || validarNome(v) === "OK", "Nome inválido"),
  phone: z
    .string()
    .nullish()
    .refine(
      (v) => v == null || v.trim() === "" || validarTelefone(v) === "OK",
      "Telefone inválido"
    ),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6, "Nova senha deve ter ao menos 6 caracteres").optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    const { name, phone, currentPassword, newPassword } = parsed.data;
    const data: Record<string, string | null> = {};

    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone || null;

    if (newPassword) {
      const user = await prisma.user.findUnique({ where: { id: session.sub } });
      if (!user || user.deletedAt) {
        return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
      }
      if (!currentPassword || !(await verifyPassword(currentPassword, user.password))) {
        return NextResponse.json({ error: "Senha atual incorreta" }, { status: 400 });
      }
      data.password = await hashPassword(newPassword);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: session.sub },
      data,
      select: { id: true, name: true, email: true, phone: true, role: true },
    });

    return NextResponse.json({ user: updated });
  } catch (err) {
    console.error("[me:patch]", err);
    return NextResponse.json({ error: "Erro ao atualizar dados" }, { status: 500 });
  }
}

// LGPD — eliminação: anonimiza a identidade, desativa e desloga. O
// histórico de pedidos é preservado por obrigação fiscal, sem dados
// pessoais (endereços também anonimizados); carrinho e wishlist apagados.
export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    if (session.role !== "CLIENT") {
      return NextResponse.json({ error: "Disponível apenas para contas de cliente" }, { status: 403 });
    }

    const anonimo = `deleted-${randomUUID()}`;
    await prisma.$transaction([
      prisma.user.update({
        where: { id: session.sub },
        data: {
          name: "Usuário removido",
          email: `${anonimo}@deleted.local`,
          phone: null,
          password: await hashPassword(randomUUID()),
          active: false,
          deletedAt: new Date(),
        },
      }),
      prisma.address.updateMany({
        where: { userId: session.sub },
        data: {
          label: "Removido",
          street: "Removido",
          number: "S/N",
          complement: null,
          neighborhood: "Removido",
          city: "Removido",
          state: "XX",
          zipCode: "00000000",
        },
      }),
      prisma.cartItem.deleteMany({ where: { cart: { userId: session.sub } } }),
      prisma.cart.deleteMany({ where: { userId: session.sub } }),
      prisma.wishlistItem.deleteMany({ where: { userId: session.sub } }),
    ]);

    await clearSession("CLIENT");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[me:delete]", err);
    return NextResponse.json({ error: "Erro ao excluir conta" }, { status: 500 });
  }
}
