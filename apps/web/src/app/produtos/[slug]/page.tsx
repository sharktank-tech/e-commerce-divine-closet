import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { AddToCart } from "@/components/loja/AddToCart";
import { ProductCard } from "@/components/loja/ProductCard";
import { FreteEstimator } from "@/components/loja/FreteEstimator";
import { WishlistButton } from "@/components/loja/WishlistButton";
import { shipping, features } from "@/config/defaults";
import { formatBRL } from "@/lib/utils";
import type { Metadata } from "next";

export const revalidate = 60;

async function getProduct(slug: string) {
  try {
    return await prisma.product.findFirst({
      where: { slug, deletedAt: null },
      include: { category: true, variations: true },
    });
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: "Produto não encontrado" };
  return {
    title: product.name,
    description: product.description.slice(0, 160),
  };
}

export default async function ProdutoDetalhePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product || !product.isActive) notFound();

  let related: Array<{
    id: string;
    name: string;
    slug: string;
    price: string | number | { toString(): string } | null;
    comparePrice?: string | number | { toString(): string } | null;
    images: string[];
    stock: number;
    category?: { name: string; slug: string };
  }> = [];

  try {
    related = await prisma.product.findMany({
      where: {
        categoryId: product.categoryId,
        id: { not: product.id },
        isActive: true,
        deletedAt: null,
      },
      include: { category: true },
      take: 4,
    });
  } catch {
    related = [];
  }

  const onSale =
    product.comparePrice && Number(product.comparePrice) > Number(product.price);
  const discount = onSale
    ? Math.round(
        ((Number(product.comparePrice) - Number(product.price)) /
          Number(product.comparePrice)) *
          100
      )
    : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <nav className="mb-6 text-xs text-ink-mute">
        <Link href="/" className="hover:text-ink">Início</Link>
        {" / "}
        <Link href="/produtos" className="hover:text-ink">Coleção</Link>
        {" / "}
        <Link href={`/produtos?categoria=${product.category.slug}`} className="hover:text-ink">
          {product.category.name}
        </Link>
        {" / "}
        <span className="text-ink-soft">{product.name}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="aspect-[3/4] overflow-hidden rounded-2xl border border-ink/10 bg-primary-100">
            {product.images[0] ? (
              <img
                src={product.images[0]}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-primary-400">
                <span className="font-display text-6xl">DC</span>
              </div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="grid grid-cols-4 gap-3">
              {product.images.slice(1, 5).map((img, i) => (
                <div key={i} className="aspect-square overflow-hidden rounded-lg border border-ink/10 bg-primary-100">
                  <img src={img} alt="" className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-700">
            {product.category.name}
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink sm:text-4xl">
            {product.name}
          </h1>

          <div className="mt-4 flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-bold text-ink">{formatBRL(product.price)}</span>
            {onSale && (
              <>
                <span className="text-lg text-ink-mute line-through">
                  {formatBRL(product.comparePrice!)}
                </span>
                <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">
                  -{discount}%
                </span>
              </>
            )}
          </div>

          <div className="mt-3 text-sm">
            {product.stock > 0 ? (
              <span className="text-emerald-700">✓ Em estoque ({product.stock} un.)</span>
            ) : (
              <span className="text-red-600">Esgotado</span>
            )}
          </div>

          <div className="mt-6 border-t border-ink/10 pt-6">
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">
              {product.description}
            </p>
          </div>

          <AddToCart
            productId={product.id}
            stock={product.stock}
            sizes={product.sizes}
            colors={product.colors}
            variations={product.variations.map((v) => ({
              size: v.size,
              color: v.color,
              stock: v.stock,
            }))}
          />

          <div className="mt-6">
            <FreteEstimator subtotal={Number(product.price)} />
          </div>

          {features.wishlist && (
            <div className="mt-4">
              <WishlistButton productId={product.id} />
            </div>
          )}

          <ul className="mt-8 space-y-2 border-t border-ink/10 pt-6 text-sm text-ink-mute">
            <li>• Frete grátis em compras acima de {formatBRL(shipping.freeFrom)}</li>
            <li>• Troca ou devolução em até 30 dias</li>
            <li>• Envio com rastreio para todo o Brasil</li>
          </ul>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-16 border-t border-ink/10 pt-10">
          <h2 className="font-display text-2xl font-bold text-ink">Você também pode gostar</h2>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
