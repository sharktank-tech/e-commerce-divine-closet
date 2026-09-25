import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const body = (await req.json()) as {
      active?: boolean;
      value?: number;
      maxUses?: number | null;
      endsAt?: string | null;
      deletedAt?: string | null;
    };

    const coupon = await prisma.coupon.update({
      where: { id },
      data: {
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.value !== undefined ? { value: body.value } : {}),
        ...(body.maxUses !== undefined ? { maxUses: body.maxUses } : {}),
        ...(body.endsAt !== undefined
          ? { endsAt: body.endsAt ? new Date(body.endsAt) : null }
          : {}),
        ...(body.deletedAt !== undefined
          ? { deletedAt: body.deletedAt ? new Date(body.deletedAt) : null }
          : {}),
      },
    });

    return NextResponse.json({ coupon });
  } catch (err) {
    console.error("[admin:cupom:patch]", err);
    return NextResponse.json({ error: "Erro ao atualizar cupom" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    await prisma.coupon.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin:cupom:delete]", err);
    return NextResponse.json({ error: "Erro ao excluir cupom" }, { status: 500 });
  }
}
