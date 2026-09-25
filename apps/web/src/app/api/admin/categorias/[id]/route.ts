import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, forbidden } from "@/lib/auth";
import { slugify } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().nullish(),
  status: z.enum(["ACTIVE", "HIDDEN"]).optional(),
  parentId: z.string().nullish(),
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

    const current = await prisma.category.findUnique({ where: { id } });
    if (!current || current.deletedAt) {
      return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
    }

    const name = parsed.data.name ?? current.name;
    const slug = parsed.data.name ? slugify(parsed.data.name) : current.slug;

    if (name !== current.name || slug !== current.slug) {
      const [bySlug, byName] = await Promise.all([
        prisma.category.findUnique({ where: { slug } }),
        prisma.category.findUnique({ where: { name } }),
      ]);
      const active = [bySlug, byName].filter((c) => c && !c.deletedAt && c.id !== id);
      if (active.length > 0) {
        return NextResponse.json({ error: "Já existe categoria com esse nome" }, { status: 409 });
      }
      // libera chaves ocupadas por categorias já removidas
      for (const c of [bySlug, byName]) {
        if (c && c.deletedAt) {
          const suffix = `removida-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          await prisma.category.update({
            where: { id: c.id },
            data: { name: `${c.name} (${suffix})`, slug: `${c.slug}-${suffix}` },
          });
        }
      }
    }

    const category = await prisma.category.update({
      where: { id },
      data: {
        ...parsed.data,
        name,
        slug,
      },
    });

    return NextResponse.json({ category });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
      return NextResponse.json({ error: "Já existe categoria com esse nome" }, { status: 409 });
    }
    console.error("[admin:categoria:patch]", err);
    return NextResponse.json({ error: "Erro ao atualizar categoria" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireAuth("ADMIN");
    if (!session) return forbidden();

    const { id } = await params;
    const inUse = await prisma.product.count({
      where: { categoryId: id, deletedAt: null },
    });
    if (inUse > 0) {
      return NextResponse.json(
        { error: `Categoria com ${inUse} produto(s). Mova os produtos antes de excluir.` },
        { status: 409 }
      );
    }

    const current = await prisma.category.findUnique({ where: { id } });
    if (!current || current.deletedAt) {
      return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
    }

    // soft delete precisa liberar name/slug (@unique) para permitir recriar depois
    const suffix = `removida-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await prisma.category.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: "HIDDEN",
        name: `${current.name} (${suffix})`,
        slug: `${current.slug}-${suffix}`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin:categoria:delete]", err);
    return NextResponse.json({ error: "Erro ao excluir categoria" }, { status: 500 });
  }
}
