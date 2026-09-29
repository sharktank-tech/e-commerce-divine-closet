import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

function base(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://www.divinecloset.com.br").replace(
    /\/$/,
    ""
  );
}

const STATIC_ROUTES = [
  "/",
  "/produtos",
  "/ofertas",
  "/institucional",
  "/trocas",
  "/faq",
  "/contato",
  "/privacidade",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const root = base();
  const now = new Date();

  try {
    const [products, categories] = await Promise.all([
      prisma.product.findMany({
        where: { isActive: true, deletedAt: null },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 5000,
      }),
      prisma.category.findMany({
        where: { status: "ACTIVE", deletedAt: null },
        select: { slug: true, updatedAt: true },
      }),
    ]);

    return [
      ...STATIC_ROUTES.map((p) => ({
        url: `${root}${p === "/" ? "" : p}`,
        lastModified: now,
        changeFrequency: "daily" as const,
        priority: p === "/" ? 1 : 0.7,
      })),
      ...categories.map((c) => ({
        url: `${root}/categoria/${c.slug}`,
        lastModified: c.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
      ...products.map((p) => ({
        url: `${root}/produtos/${p.slug}`,
        lastModified: p.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.9,
      })),
    ];
  } catch {
    // banco fora do ar no build: sitemap mínimo para não quebrar o deploy
    return STATIC_ROUTES.map((p) => ({
      url: `${root}${p === "/" ? "" : p}`,
      lastModified: now,
    }));
  }
}
