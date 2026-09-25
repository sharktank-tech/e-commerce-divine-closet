import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";

export async function GET() {
  try {
    const items = await prisma.banner.findMany({
      where: { deletedAt: null },
      orderBy: { position: "asc" },
    });
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[admin:banners:list]", err);
    return NextResponse.json({ error: "Erro ao carregar banners" }, { status: 500 });
  }
}

const createSchema = z.object({
  title: z.string().min(2),
  subtitle: z.string().nullish(),
  imageUrl: z.string().min(1),
  linkUrl: z.string().nullish(),
  position: z.number().int().min(0).default(0),
  status: z.enum(["ACTIVE", "HIDDEN"]).default("ACTIVE"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    const banner = await prisma.banner.create({ data: parsed.data });
    return NextResponse.json({ banner }, { status: 201 });
  } catch (err) {
    console.error("[admin:banners:create]", err);
    return NextResponse.json({ error: "Erro ao criar banner" }, { status: 500 });
  }
}
