import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ProductCard } from "@/components/loja/ProductCard";
import { BannerCarousel } from "@/components/loja/BannerCarousel";
import { Button } from "@/components/ui/Button";
import { shipping, institutional, payment } from "@/config/defaults";
import { shouldShow, takeFresh } from "@/lib/home";
import { publicProductCardSelect, toPublicCardProduct } from "@/lib/produto-publico";

export const revalidate = 60;

const AVAILABLE = { isActive: true, deletedAt: null, stock: { gt: 0 } } as const;

async function getData() {
  try {
    const used = new Set<string>();

    // 1. Destaques marcados no admin...
    let destaques = await prisma.product.findMany({
      where: { ...AVAILABLE, featured: true },
      select: publicProductCardSelect,
      take: 8,
      orderBy: { createdAt: "desc" },
    });
    if (destaques.length === 0) {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const top = await prisma.orderItem.groupBy({
        by: ["productId"],
        where: { order: { createdAt: { gte: since }, paymentStatus: "PAID" } },
        _count: { productId: true },
        orderBy: { _count: { productId: "desc" } },
        take: 8,
      });
      const rank = new Map(top.map((t, i) => [t.productId, i]));
      const prods = await prisma.product.findMany({
        where: { ...AVAILABLE, id: { in: top.map((t) => t.productId) } },
        select: publicProductCardSelect,
      });
      destaques = prods.sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
    }
    destaques = takeFresh(destaques, used, 8);

    // 2. Novidades
    const recentes = await prisma.product.findMany({
      where: { ...AVAILABLE, id: { notIn: [...used] } },
      select: publicProductCardSelect,
      take: 8,
      orderBy: { createdAt: "desc" },
    });
    const novidades = takeFresh(recentes, used, 8);

    // 3. Ofertas
    const promos = await prisma.product.findMany({
      where: { ...AVAILABLE, discountPercent: { gt: 0 }, id: { notIn: [...used] } },
      select: publicProductCardSelect,
      take: 8,
      orderBy: [{ discountPercent: "desc" }, { createdAt: "desc" }],
    });
    const ofertas = takeFresh(promos, used, 8);

    // 4. Categorias para o carrossel/home
    const categories = await prisma.category.findMany({
      where: { status: "ACTIVE", deletedAt: null, showInHome: true },
      orderBy: [{ menuOrder: "asc" }, { name: "asc" }],
    });

    // 5. Banners
    const banners = await prisma.banner.findMany({ where: { status: "ACTIVE", deletedAt: null } });

    // Contagem ofertas (dos produtos promocionais)
    const offersCount = ofertas.length;

    return { destaques, novidades, ofertas, categories, banners, offersCount };
  } catch {
    return { destaques: [], novidades: [], ofertas: [], categories: [], banners: [], offersCount: 0, error: true };
  }
}

export default async function Home() {
  const { destaques, novidades, ofertas, categories, banners, offersCount, error } = await getData();

  // Filtrar categorias que têm produtos ativos
  const catsWithProducts = categories;

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      {/* Hero / banners */}
      {banners.length > 0 && <BannerCarousel banners={banners} />}

      {/* Compre por categoria - carrossel horizontal */}
      {catsWithProducts.length > 0 && (
        <section
          className="mx-auto max-w-7xl px-4 py-14 sm:px-6"
          aria-label="Compre por categoria"
        >
          <h2 className="font-display text-2xl font-bold text-ink mb-6">
            Compre por categoria
          </h2>

          {/* Container do carrossel com scroll suave */}
          <div className="carousel-track overflow-x-auto overflow-y-hidden" style={{ scrollBehavior: "smooth" }}>
            <div className="carousel-card flex gap-2 min-w-min">
              {catsWithProducts.map((c) => (
                <Link
                  key={c.id}
                  href={`/categoria/${c.slug}`}
                  className="flex flex-col shrink-0 rounded-xl border border-ink/10 bg-white overflow-hidden hover:border-primary-400 hover:shadow-md transition-all duration-200"
                  aria-label={c.name}
                >
                  {c.image ? (
                    <div className="aspect-[4/3] overflow-hidden bg-primary-100">
                      <img
                        src={c.image}
                        alt={c.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                      />
                    </div>
                  ) : (
                    <div
                      className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-primary-200 via-primary-100 to-primary-50"
                    >
                      <span className="font-display text-3xl font-bold text-primary-700">
                        {c.name.charAt(0)}
                      </span>
                    </div>
                  )}
                  <p className="p-2 font-medium text-ink">{c.name}</p>
                </Link>
              ))}
            </div>
          </div>

          {/* Setas de navegação (apenas desktop, >768px) */}
          {typeof window !== "undefined" && window.innerWidth >= 768 && (
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                className="prev-btn rounded-full bg-primary-50 px-3 py-1 text-ink-mute hover:text-ink transition-colors"
                aria-label="Categoria anterior"
                onClick={() => {
                  const container = document.querySelector(
                    '[overflow-x="auto"]'
                  ) as HTMLElement;
                  if (container) container.scrollBy({ left: -300, behavior: "smooth" });
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                className="next-btn rounded-full bg-primary-50 px-3 py-1 text-ink-mute hover:text-ink transition-colors"
                aria-label="Próxima categoria"
                onClick={() => {
                  const container = document.querySelector(
                    '[overflow-x="auto"]'
                  ) as HTMLElement;
                  if (container) container.scrollBy({ left: 300, behavior: "smooth" });
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M10 8l8 8-8 8" />
                </svg>
              </button>
            </div>
          )}
        </section>
      )}

      {/* Destaques da semana */}
      {shouldShow(destaques) && (
        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-display text-2xl font-bold text-ink">Destaques da semana</h2>
              <p className="mt-1 text-sm text-ink-mute">As peças mais desejadas agora.</p>
            </div>
            <Link href="/produtos" className="text-sm font-semibold text-primary-700 hover:underline">
              Ver todas →
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {destaques.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      <section className="bg-ink py-14 text-primary-50">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:grid-cols-3 sm:px-6">
          {[
            { t: "Entrega nacional", d: "Envio para todo o Brasil com código de rastreio." },
            { t: "Troca em 30 dias", d: "Não serviu? Troque sem burocracia." },
            {
              t: "Pagamento seguro",
              d:
                payment.driver === "mock"
                  ? "Ambiente sandbox em desenvolvimento."
                  : "Cartão, Pix e boleto.",
            },
          ].map((f) => (
            <div key={f.t} className="text-center sm:text-left">
              <p className="font-semibold">{f.t}</p>
              <p className="mt-1 text-sm text-primary-200">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {shouldShow(novidades) && (
        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-2xl font-bold text-ink">Chegaram agora</h2>
            <Link href="/produtos" className="text-sm font-semibold text-primary-700 hover:underline">
              Catálogo completo →
            </Link>
          </div>

          {error ? (
            <div className="mt-8 rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
              Não foi possível conectar ao banco de dados. Suba o Postgres com{" "}
              <code className="rounded bg-amber-100 px-1.5 py-0.5">docker compose up -d</code>,
              rode <code className="rounded bg-amber-100 px-1.5 py-0.5">npm run prisma:migrate</code> e{" "}
              <code className="rounded bg-amber-100 px-1.5 py-0.5">npm run db:seed</code>.
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
              {novidades.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </section>
      )}

      {shouldShow(ofertas) && (
        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-display text-2xl font-bold text-ink">Em oferta</h2>
              <p className="mt-1 text-sm text-ink-mute">Descontos reais por tempo limitado.</p>
            </div>
            <Link href="/ofertas" className="text-sm font-semibold text-primary-700 hover:underline">
              Ver todas →
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {ofertas.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      <section className="border-t border-ink/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-[1.5fr_1fr]">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">Sobre a Divine Closet</h2>
            <p className="mt-4 max-w-2xl whitespace-pre-line leading-relaxed text-ink-mute">
              {institutional.about}
            </p>
            <Button href="/institucional" variant="outline" className="mt-6">
              Conhecer a marca
            </Button>
          </div>
          <aside className="rounded-2xl border border-accent-200 bg-accent-50 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent-700">
              Banner promocional
            </p>
            <p className="mt-2 font-display text-xl font-bold text-ink">
              Nova coleção disponível
            </p>
            <p className="mt-1 text-sm text-ink-mute">
              {/* TODO-CLIENTE: substituir por banners reais via admin */}
              Imagem placeholder até o cliente enviar artes.
            </p>
            <Button href="/produtos" size="sm" className="mt-4">
              Ver agora
            </Button>
          </aside>
        </div>
      </section>
    </div>
  );
}
