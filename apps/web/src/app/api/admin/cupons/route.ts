import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

const schema = z.object({
  code: z.string().min(3).transform((s) => s.toUpperCase()),
  type: z.enum(["PERCENT", "FIXED", "FREE_SHIPPING"]),
  value: z.number().min(0).default(0),
  minSubtotal: z.number().min(0).nullish(),
  maxUses: z.number().int().positive().nullish(),
  endsAt: z.string().datetime().nullish(),
  active: z.boolean().default(true),
});

export async function GET() {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const items = await prisma.coupon.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[admin:cupons]", err);
    return NextResponse.json({ error: "Erro ao carregar cupons" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const coupon = await prisma.coupon.create({
      data: {
        code: data.code,
        type: data.type,
        value: data.value,
        minSubtotal: data.minSubtotal ?? null,
        maxUses: data.maxUses ?? null,
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        active: data.active,
      },
    });

    return NextResponse.json({ coupon }, { status: 201 });
  } catch (err) {
    console.error("[admin:cupons:create]", err);
    return NextResponse.json({ error: "Erro ao criar cupom" }, { status: 500 });
  }
}
