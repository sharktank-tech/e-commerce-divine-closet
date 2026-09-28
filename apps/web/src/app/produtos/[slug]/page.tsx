import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { AddToCart } from "@/components/loja/AddToCart";
import { ProductCard } from "@/components/loja/ProductCard";
import { ProductSlideshow } from "@/components/loja/ProductSlideshow";
import { FreteEstimator } from "@/components/loja/FreteEstimator";
import { WishlistButton } from "@/components/loja/WishlistButton";
import { shipping, features, institutional } from "@/config/defaults";
import { formatBRL } from "@/lib/utils";
import { estadoEstoque, textoEstoque } from "@/lib/estoque";
import { resolveSizeTable } from "@/lib/medidas";
import type { Metadata } from "next";

export const revalidate = 60;

async function getProduct(slug: string) {
  try {
    return await prisma.product.findFirst({
      where: { slug, deletedAt: null },
      include: {
        category: { include: { sizeTable: true } },
        variations: true,
        tabelaMedidas: true,
      },
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
  if (!product || !product.isActive) {
    // slug antigo renomeado? redireciona permanente (308, equivalência SEO ao 301).
    // NB: permanentRedirect lança exceção interna — ficar FORA do try/catch.
    let redir = null;
    try {
      redir = await prisma.slugRedirect.findUnique({ where: { oldSlug: slug } });
    } catch {
      // ignora e cai no 404
    }
    if (redir) permanentRedirect(`/produtos/${redir.newSlug}`);
    notFound();
  }

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
            <ProductSlideshow
              images={product.images}
              name={product.name}
              intervalMs={1500}
              imageColors={product.imageColors}
              imageAlts={product.imageAlts}
              thumbs
              zoomable
            />
          </div>
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
            {estadoEstoque(product.stock) === "esgotado" ? (
              <span className="text-red-600">Esgotado</span>
            ) : estadoEstoque(product.stock) === "baixo" ? (
              <span className="font-semibold text-amber-700">{textoEstoque(product.stock)}</span>
            ) : (
              <span className="text-emerald-700">✓ Em estoque</span>
            )}
          </div>

          {(product.modeloAltura || product.modeloVeste) && (
            <p className="mt-2 text-xs text-ink-mute">
              Modelo: {product.modeloAltura || "—"}
              {product.modeloVeste ? `, veste ${product.modeloVeste}` : ""}
            </p>
          )}

          <div className="mt-6 space-y-3 border-t border-ink/10 pt-6">
            <details className="group rounded-xl border border-ink/10 bg-white" open>
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
                Descrição
              </summary>
              <div className="border-t border-ink/10 px-4 py-3">
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">
                  {product.description}
                </p>
                {(product.comprimento || product.caimento || product.ocasiao) && (
                  <dl className="mt-3 space-y-1.5 text-sm">
                    {product.comprimento && (
                      <div className="flex gap-2">
                        <dt className="text-ink-mute">Comprimento:</dt>
                        <dd className="text-ink">{product.comprimento}</dd>
                      </div>
                    )}
                    {product.caimento && (
                      <div className="flex gap-2">
                        <dt className="text-ink-mute">Caimento:</dt>
                        <dd className="text-ink">{product.caimento}</dd>
                      </div>
                    )}
                    {product.ocasiao && (
                      <div className="flex gap-2">
                        <dt className="text-ink-mute">Ocasião:</dt>
                        <dd className="text-ink">{product.ocasiao}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            </details>

            {(product.composicao || product.instrucoesLavagem) && (
              <details className="group rounded-xl border border-ink/10 bg-white">
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  Composição e cuidados
                </summary>
                <div className="space-y-2 border-t border-ink/10 px-4 py-3 text-sm leading-relaxed text-ink-soft">
                  {product.composicao && (
                    <p className="whitespace-pre-line">{product.composicao}</p>
                  )}
                  {product.instrucoesLavagem && (
                    <p className="whitespace-pre-line">{product.instrucoesLavagem}</p>
                  )}
                </div>
              </details>
            )}

            <details className="group rounded-xl border border-ink/10 bg-white">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
                Envio e trocas
              </summary>
              <div className="space-y-2 border-t border-ink/10 px-4 py-3 text-sm leading-relaxed text-ink-soft">
                <p>Frete grátis em compras acima de {formatBRL(shipping.freeFrom)}.</p>
                <p className="whitespace-pre-line">{institutional.exchangePolicy}</p>
              </div>
            </details>
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
            sizeTable={resolveSizeTable(
              product.tabelaMedidas,
              product.category?.sizeTable ?? null
            )}
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
