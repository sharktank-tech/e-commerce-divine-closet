import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const addressSchema = z.object({
  label: z.string().optional(),
  street: z.string().min(3),
  number: z.string().min(1),
  complement: z.string().nullish(),
  neighborhood: z.string().min(2),
  city: z.string().min(2),
  state: z.string().min(2),
  zipCode: z.string().min(8),
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

    const count = await prisma.address.count({ where: { userId: session.sub } });
    const isDefault = parsed.data.isDefault || count === 0;

    if (isDefault) {
      await prisma.address.updateMany({
        where: { userId: session.sub },
        data: { isDefault: false },
      });
    }

    const address = await prisma.address.create({
      data: {
        userId: session.sub,
        label: parsed.data.label || "Principal",
        street: parsed.data.street,
        number: parsed.data.number,
        complement: parsed.data.complement || null,
        neighborhood: parsed.data.neighborhood,
        city: parsed.data.city,
        state: parsed.data.state.toUpperCase(),
        zipCode: parsed.data.zipCode,
        isDefault,
      },
    });

    return NextResponse.json({ address }, { status: 201 });
  } catch (err) {
    console.error("[enderecos:create]", err);
    return NextResponse.json({ error: "Erro ao salvar endereço" }, { status: 500 });
  }
}
