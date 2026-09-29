import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Catalogo } from "@/components/loja/Catalogo";
import { absoluteUrl, buildCategoryDescription, buildCategoryTitle } from "@/lib/seo";

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
  const title = buildCategoryTitle(category.name);
  const description = buildCategoryDescription(category.name);
  const url = `/categoria/${category.slug}`;
  const images = category.image ? [absoluteUrl(category.image)] : [];
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, images },
    twitter: { card: "summary_large_image", title, description, images },
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

  const site = (process.env.NEXT_PUBLIC_APP_URL || "https://www.divinecloset.com.br").replace(/\/$/, "");
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Início", item: `${site}/` },
      { "@type": "ListItem", position: 2, name: "Coleção", item: `${site}/produtos` },
      { "@type": "ListItem", position: 3, name: category.name },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
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
        soOferta: str(sp.oferta) === "1",
      }}
      />
    </>
  );
}
