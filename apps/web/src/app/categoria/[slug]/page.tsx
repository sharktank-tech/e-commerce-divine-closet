import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Catalogo } from "@/components/loja/Catalogo";

export const revalidate = 30;

type Search = { [key: string]: string | string[] | undefined };
type Params = { params: Promise<{ slug: string }> };

function str(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

async function getCategory(slug: string) {
  try {
    return await prisma.category.findFirst({
      where: { slug, status: "ACTIVE", deletedAt: null },
    });
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) return { title: "Categoria não encontrada" };
  return {
    title: `${category.name} | Divine Closet`,
    description: `${category.name} femininos com entrega para todo o Brasil e troca em 30 dias. Confira a seleção Divine Closet.`,
  };
}

export default async function CategoriaPage({
  params,
  searchParams,
}: Params & { searchParams: Promise<Search> }) {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) notFound();

  const sp = await searchParams;

  return (
    <Catalogo
      basePath={`/categoria/${slug}`}
      lockedCategoria={slug}
      title={category.name}
      initial={{
        q: str(sp.q),
        categoria: slug,
        sort: str(sp.sort) || "recent",
        page: Math.max(1, Number(str(sp.page) || 1)),
        precoMin: Number(str(sp.preco_min)) || 0,
        precoMax: Number(str(sp.preco_max)) || 0,
        soEstoque: str(sp.estoque) === "1",
      }}
    />
  );
}
