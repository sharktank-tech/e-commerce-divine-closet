import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const patchSchema = z.object({
  label: z.string().optional(),
  street: z.string().min(3).optional(),
  number: z.string().min(1).optional(),
  complement: z.string().nullish(),
  neighborhood: z.string().min(2).optional(),
  city: z.string().min(2).optional(),
  state: z.string().min(2).optional(),
  zipCode: z.string().min(8).optional(),
  isDefault: z.boolean().optional(),
});

async function own(req: NextRequest, id: string) {
  const session = await getSession(req);
  if (!session) return { error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  const address = await prisma.address.findUnique({ where: { id } });
  if (!address || address.userId !== session.sub) {
    return { error: NextResponse.json({ error: "Endereço não encontrado" }, { status: 404 }) };
  }
  return { session, address };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const check = await own(req, id);
    if ("error" in check) return check.error;

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    const data = { ...parsed.data };
    if (data.state) data.state = data.state.toUpperCase();
    if (data.isDefault) {
      await prisma.address.updateMany({
        where: { userId: check.session!.sub },
        data: { isDefault: false },
      });
    }

    const address = await prisma.address.update({ where: { id }, data });
    return NextResponse.json({ address });
  } catch (err) {
    console.error("[endereco:patch]", err);
    return NextResponse.json({ error: "Erro ao atualizar endereço" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const check = await own(req, id);
    if ("error" in check) return check.error;

    await prisma.address.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[endereco:delete]", err);
    return NextResponse.json({ error: "Erro ao remover endereço" }, { status: 500 });
  }
}
