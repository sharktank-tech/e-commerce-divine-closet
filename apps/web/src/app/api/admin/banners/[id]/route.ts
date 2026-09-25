import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().min(2).optional(),
  subtitle: z.string().nullish(),
  imageUrl: z.string().min(1).optional(),
  linkUrl: z.string().nullish(),
  position: z.number().int().min(0).optional(),
  status: z.enum(["ACTIVE", "HIDDEN"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const banner = await prisma.banner.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ banner });
  } catch (err) {
    console.error("[admin:banner:patch]", err);
    return NextResponse.json({ error: "Erro ao atualizar banner" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    await prisma.banner.update({
      where: { id },
      data: { deletedAt: new Date(), status: "HIDDEN" },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin:banner:delete]", err);
    return NextResponse.json({ error: "Erro ao excluir banner" }, { status: 500 });
  }
}
