import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { enderecoSchema } from "@/lib/validacao";
import { type DbEnderecos, definirPadrao } from "@/lib/enderecos";

const addressSchema = enderecoSchema.extend({
  label: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const addresses = await prisma.address.findMany({
      where: { userId: session.sub },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ addresses });
  } catch (err) {
    console.error("[enderecos:list]", err);
    return NextResponse.json({ error: "Erro ao carregar endereços" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const body = await req.json();
    const parsed = addressSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    const data = {
      street: parsed.data.street,
      // number já normalizado pelo zod (vazio → "s/n").
      number: parsed.data.number,
      complement: parsed.data.complement || null,
      neighborhood: parsed.data.neighborhood,
      city: parsed.data.city,
      state: parsed.data.state.toUpperCase(),
      zipCode: parsed.data.zipCode,
    };

    // Dedupe: confirmar o MESMO endereço de novo devolve o registro já
    // existente (200) em vez de duplicar — inclusive no fluxo do checkout.
    const existente = await prisma.address.findFirst({
      where: { userId: session.sub, ...data },
    });
    if (existente) {
      const total = await prisma.address.count({ where: { userId: session.sub } });
      const querPadrao = parsed.data.isDefault || total === 0;
      const address =
        querPadrao && !existente.isDefault
          ? await prisma.$transaction((tx) =>
              definirPadrao(tx as DbEnderecos, session.sub, existente.id)
            )
          : existente;
      return NextResponse.json({ address, existente: true }, { status: 200 });
    }

    const total = await prisma.address.count({ where: { userId: session.sub } });
    // Primeiro endereço do usuário vira padrão automaticamente.
    const querPadrao = parsed.data.isDefault || total === 0;

    // Criação + padrão numa única transação (lock na linha do usuário).
    const address = await prisma.$transaction(async (tx) => {
      const db = tx as DbEnderecos;
      const criado = await db.address.create({
        data: {
          userId: session.sub,
          label: parsed.data.label || "Principal",
          ...data,
          isDefault: false,
        },
      });
      if (!querPadrao) return criado;
      return definirPadrao(db, session.sub, criado.id);
    });

    return NextResponse.json({ address }, { status: 201 });
  } catch (err) {
    console.error("[enderecos:create]", err);
    return NextResponse.json({ error: "Erro ao salvar endereço" }, { status: 500 });
  }
}
