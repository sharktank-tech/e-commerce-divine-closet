import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ProductCard } from "@/components/loja/ProductCard";
import { BannerCarousel } from "@/components/loja/BannerCarousel";
import { Button } from "@/components/ui/Button";
import { shipping, institutional } from "@/config/defaults";

export const revalidate = 60;

async function getData() {
  try {
    const [featured, latest, categories, count, banners] = await Promise.all([
      prisma.product.findMany({
        where: { isActive: true, featured: true, deletedAt: null },
        include: { category: true },
        take: 4,
        orderBy: { createdAt: "desc" },
      }),
      prisma.product.findMany({
        where: { isActive: true, deletedAt: null },
        include: { category: true },
        take: 8,
        orderBy: { createdAt: "desc" },
      }),
      prisma.category.findMany({
        where: { status: "ACTIVE", deletedAt: null },
        orderBy: { name: "asc" },
        take: 6,
      }),
      prisma.product.count({ where: { isActive: true, deletedAt: null } }),
      prisma.banner.findMany({
        where: { status: "ACTIVE", deletedAt: null },
        orderBy: { position: "asc" },
        take: 5,
      }),
    ]);
    return { featured, latest, categories, count, banners, error: false };
  } catch {
    return { featured: [], latest: [], categories: [], count: 0, banners: [], error: true };
  }
}

export default async function HomePage() {
  const { featured, latest, categories, banners, error } = await getData();

  return (
    <div>
      <section className="relative overflow-hidden bg-[#290582]">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-primary-400/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-full bg-accent-400/20 blur-3xl"
        />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 md:grid-cols-2 md:py-24">
          <div>
            <span className="inline-block rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white">
              Nova coleção
            </span>
            <h1 className="mt-5 font-display text-4xl font-bold leading-tight text-white sm:text-5xl lg:text-6xl">
              Vista-se de
              <span className="text-accent-300"> formas divinas</span>
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-primary-100 sm:text-lg">
              Peças exclusivas, caimento impecável e curadoria de moda para
              mulheres que brilham no dia a dia e nas ocasiões especiais.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                href="/produtos"
                size="lg"
                className="bg-white text-[#290582] hover:bg-primary-100"
              >
                Explorar coleção
              </Button>
              <Button
                href="/produtos?sort=price_asc"
                variant="outline"
                size="lg"
                className="border-white/40 text-white hover:border-white hover:bg-white/10"
              >
                Ver ofertas
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="aspect-[4/5] overflow-hidden rounded-3xl bg-white/10 shadow-2xl">
              <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                <img
                  src="/logo.png"
                  alt="Divine Closet"
                  className="h-44 w-44 rounded-full object-cover shadow-2xl ring-4 ring-white/20"
                />
                <p className="max-w-xs text-sm text-primary-100">
                  Sua próxima peça favorita está aqui.
                </p>
              </div>
            </div>
            <div className="absolute -bottom-5 -left-5 rounded-2xl bg-white px-5 py-4 shadow-xl">
              <p className="text-xs text-ink-mute">Frete grátis acima de</p>
              <p className="text-lg font-bold text-ink">
                R$ {shipping.freeFrom.toFixed(2).replace(".", ",")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {banners.length > 0 && <BannerCarousel banners={banners} />}

      {categories.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <h2 className="font-display text-2xl font-bold text-ink">Compre por categoria</h2>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/produtos?categoria=${c.slug}`}
                className="group rounded-xl border border-ink/10 bg-white p-5 text-center transition-all hover:border-primary-400 hover:shadow-md"
              >
                <p className="font-medium text-ink group-hover:text-primary-700">{c.name}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {featured.length > 0 && (
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
            {featured.map((p) => (
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
            { t: "Pagamento seguro", d: "Ambiente sandbox em desenvolvimento." },
          ].map((f) => (
            <div key={f.t} className="text-center sm:text-left">
              <p className="font-semibold">{f.t}</p>
              <p className="mt-1 text-sm text-primary-200">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

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
        ) : latest.length === 0 ? (
          <p className="mt-8 text-ink-mute">Nenhum produto cadastrado ainda.</p>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {latest.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

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
