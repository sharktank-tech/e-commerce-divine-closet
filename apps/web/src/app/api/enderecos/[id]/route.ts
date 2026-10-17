import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Address } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession, type SessionPayload } from "@/lib/auth";
import { enderecoSchema } from "@/lib/validacao";
import { type DbEnderecos, definirPadrao } from "@/lib/enderecos";

const patchSchema = enderecoSchema.partial().extend({
  label: z.string().optional(),
  isDefault: z.boolean().optional(),
});

// NextResponse = falha de acesso; objeto = endereço já verificado como do dono.
async function own(
  req: NextRequest,
  id: string
): Promise<NextResponse | { session: SessionPayload; address: Address }> {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const address = await prisma.address.findUnique({ where: { id } });
  if (!address || address.userId !== session.sub) {
    return NextResponse.json({ error: "Endereço não encontrado" }, { status: 404 });
  }
  return { session, address };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const check = await own(req, id);
    if (check instanceof NextResponse) return check;

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    const { ...campos } = parsed.data;
    const data: Record<string, unknown> = { ...campos };
    if (typeof data.state === "string") data.state = data.state.toUpperCase();

    // Troca de padrão: atualização + limpeza dos demais na MESMA transação
    // (com lock no usuário) — só um padrão por conta, mesmo concorrência.
    // isDefault=false já vai em `data` (desmarcar não afeta os demais).
    const address = await prisma.$transaction(async (tx) => {
      const db = tx as DbEnderecos;
      const atualizado = await db.address.update({ where: { id }, data });
      if (parsed.data.isDefault !== true) return atualizado;
      return definirPadrao(db, check.session.sub, id, true);
    });

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
    if (check instanceof NextResponse) return check;

    await prisma.address.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[endereco:delete]", err);
    return NextResponse.json({ error: "Erro ao remover endereço" }, { status: 500 });
  }
}
