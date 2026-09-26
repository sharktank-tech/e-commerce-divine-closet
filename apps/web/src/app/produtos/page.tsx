import { prisma } from "@/lib/prisma";
import { ProductCard } from "@/components/loja/ProductCard";
import { slugify } from "@/lib/utils";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Coleção",
  description: "Todos os produtos da Divine Closet",
};

export const revalidate = 30;

type Search = { [key: string]: string | string[] | undefined };

function str(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const q = str(sp.q);
  const categoria = str(sp.categoria);
  const sort = str(sp.sort) || "recent";
  const page = Math.max(1, Number(str(sp.page) || 1));
  const precoMin = Number(str(sp.preco_min)) || 0;
  const precoMax = Number(str(sp.preco_max)) || 0;
  const soEstoque = str(sp.estoque) === "1";
  const pageSize = 12;

  let cats: { id: string; name: string; slug: string; _count?: { products: number } }[] = [];
  try {
    cats = await prisma.category.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });
  } catch {
    cats = [];
  }

  const price: { gte?: number; lte?: number } = {};
  if (precoMin > 0) price.gte = precoMin;
  if (precoMax > 0) price.lte = precoMax;

  const where = {
    isActive: true,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
            { sku: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(categoria ? { category: { slug: categoria } } : {}),
    ...(Object.keys(price).length ? { price } : {}),
    ...(soEstoque ? { stock: { gt: 0 } } : {}),
    deletedAt: null,
  };

  const orderBy =
    sort === "price_asc"
      ? { price: "asc" as const }
      : sort === "price_desc"
        ? { price: "desc" as const }
        : sort === "sales"
          ? { orderItems: { _count: "desc" as const } }
          : { createdAt: "desc" as const };

  let items: unknown[] = [];
  let total = 0;
  let dbError = false;

  try {
    [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { category: true },
      }),
    ]);
  } catch {
    dbError = true;
  }

  const totalPages = Math.ceil(total / pageSize) || 1;
  const currentCat = cats.find((c) => c.slug === categoria);

  function hrefWith(params: Record<string, string | null>) {
    const usp = new URLSearchParams();
    if (q) usp.set("q", q);
    if (categoria) usp.set("categoria", categoria);
    if (sort !== "recent") usp.set("sort", sort);
    if (precoMin > 0) usp.set("preco_min", String(precoMin));
    if (precoMax > 0) usp.set("preco_max", String(precoMax));
    if (soEstoque) usp.set("estoque", "1");
    for (const [k, v] of Object.entries(params)) {
      if (v === null) usp.delete(k);
      else usp.set(k, v);
    }
    const s = usp.toString();
    return `/produtos${s ? `?${s}` : ""}`;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-4 border-b border-ink/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">
            {currentCat ? currentCat.name : "Coleção completa"}
          </h1>
          <p className="mt-1 text-sm text-ink-mute">
            {dbError ? "Banco indisponível" : `${total} produto${total === 1 ? "" : "s"} encontrado${total === 1 ? "" : "s"}`}
            {q && ` para “${q}”`}
          </p>
        </div>

        <form action="/produtos" className="flex flex-wrap items-center gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar por nome ou SKU..."
            className="rounded-full border border-ink/15 bg-white px-4 py-2 text-sm outline-none focus:border-ink/40"
          />
          {categoria && <input type="hidden" name="categoria" value={categoria} />}
          <input
            name="preco_min"
            defaultValue={precoMin > 0 ? String(precoMin) : ""}
            placeholder="Mín. R$"
            inputMode="numeric"
            className="w-24 rounded-full border border-ink/15 bg-white px-3 py-2 text-sm outline-none"
          />
          <input
            name="preco_max"
            defaultValue={precoMax > 0 ? String(precoMax) : ""}
            placeholder="Máx. R$"
            inputMode="numeric"
            className="w-24 rounded-full border border-ink/15 bg-white px-3 py-2 text-sm outline-none"
          />
          <select
            name="sort"
            defaultValue={sort}
            className="rounded-full border border-ink/15 bg-white px-3 py-2 text-sm outline-none"
          >
            <option value="recent">Lançamentos</option>
            <option value="sales">Mais vendidos</option>
            <option value="price_asc">Menor preço</option>
            <option value="price_desc">Maior preço</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
            <input type="checkbox" name="estoque" value="1" defaultChecked={soEstoque} />
            Em estoque
          </label>
          <button
            type="submit"
            className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-primary-50"
          >
            Filtrar
          </button>
        </form>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href={hrefWith({ categoria: null, page: null })}
          className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${
            !categoria ? "bg-ink text-primary-50" : "bg-white text-ink-soft border border-ink/10"
          }`}
        >
          Todas
        </Link>
        {cats.map((c) => (
          <Link
            key={c.id}
            href={hrefWith({ categoria: c.slug, page: null })}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${
              categoria === c.slug
                ? "bg-ink text-primary-50"
                : "bg-white text-ink-soft border border-ink/10"
            }`}
          >
            {c.name} ({c._count?.products ?? 0})
          </Link>
        ))}
      </div>

      {dbError ? (
        <div className="mt-10 rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
          Banco de dados indisponível. Suba o Postgres e rode as migrações + seed.
        </div>
      ) : items.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="font-display text-xl text-ink">Nenhum produto encontrado</p>
          <p className="mt-2 text-sm text-ink-mute">Tente outra busca ou remova os filtros.</p>
          <Link href="/produtos" className="mt-4 inline-block text-sm font-semibold text-primary-700 underline">
            Ver todos os produtos
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {(items as Array<React.ComponentProps<typeof ProductCard>["product"]>).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-10 flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
            <Link
              key={n}
              href={hrefWith({ page: String(n) })}
              className={`h-9 w-9 rounded-full text-sm ${
                n === page
                  ? "bg-ink text-primary-50"
                  : "bg-white text-ink-soft border border-ink/10"
              } flex items-center justify-center`}
            >
              {n}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
