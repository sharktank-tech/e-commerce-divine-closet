import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { slugify } from "@/lib/utils";

type CatKeys = { id: string; name: string; slug: string };

// name/slug são @unique no banco; soft delete preserva a linha, então libera as
// chaves renomeando internamente (GET filtra deletedAt: null, invisível na UI).
async function freeCategoryKeys(cat: CatKeys, reason: string) {
  const suffix = `${reason}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await prisma.category.update({
    where: { id: cat.id },
    data: { name: `${cat.name} (${suffix})`, slug: `${cat.slug}-${suffix}` },
  });
}

async function resolveConflicts(name: string, slug: string): Promise<boolean> {
  const [bySlug, byName] = await Promise.all([
    prisma.category.findUnique({ where: { slug } }),
    prisma.category.findUnique({ where: { name } }),
  ]);
  const conflicts = [bySlug, byName].filter((c) => c !== null);
  if (conflicts.some((c) => !c.deletedAt)) return false;
  for (const c of conflicts) {
    if (c.deletedAt) await freeCategoryKeys(c, "removida");
  }
  return true;
}

export async function GET() {
  try {
    const items = await prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[admin:categorias:list]", err);
    return NextResponse.json({ error: "Erro ao carregar categorias" }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().min(2),
  description: z.string().nullish(),
  parentId: z.string().nullish(),
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

    const slug = slugify(parsed.data.name);
    const ok = await resolveConflicts(parsed.data.name, slug);
    if (!ok) {
      return NextResponse.json({ error: "Já existe categoria com esse nome" }, { status: 409 });
    }

    const category = await prisma.category.create({
      data: {
        name: parsed.data.name,
        slug,
        description: parsed.data.description || null,
        parentId: parsed.data.parentId || null,
      },
    });

    return NextResponse.json({ category }, { status: 201 });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
      return NextResponse.json({ error: "Já existe categoria com esse nome" }, { status: 409 });
    }
    console.error("[admin:categorias:create]", err);
    return NextResponse.json({ error: "Erro ao criar categoria" }, { status: 500 });
  }
}
