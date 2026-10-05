import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { buildMenu } from "@/lib/categorias";
import { payment } from "@/config/defaults";
import { getEmpresa } from "@/lib/config-loja";

async function getMenuLinks() {
  try {
    const [cats, offers] = await Promise.all([
      prisma.category.findMany({
        where: { status: "ACTIVE", deletedAt: null },
        orderBy: [{ menuOrder: "asc" }, { name: "asc" }],
        include: {
          products: {
            where: { isActive: true, deletedAt: null, stock: { gt: 0 } },
            select: { id: true },
          },
        },
      }),
      prisma.product.count({
        where: { isActive: true, deletedAt: null, discountPercent: { gt: 0 } },
      }),
    ]);
    return buildMenu(
      cats.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        image: c.image,
        menuOrder: c.menuOrder,
        showInMenu: c.showInMenu,
        showInHome: c.showInHome,
        availableCount: c.products.length,
      })),
      offers
    ).filter((m) => m.href.startsWith("/categoria/")).slice(0, 6);
  } catch {
    return [];
  }
}

export async function Footer() {
  const [catLinks, empresa] = await Promise.all([getMenuLinks(), getEmpresa()]);
  const partes = empresa.name.split(" ");
  const temContato = empresa.email || empresa.phone || empresa.address;
  return (
    <footer className="bg-primary-950 text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="flex items-center gap-2.5 font-display text-xl font-bold text-white">
            <img
              src={empresa.logoUrl || "/logo.png"}
              alt={empresa.name}
              className="h-9 w-9 rounded-full object-cover ring-2 ring-white/20"
            />
            <span>
              {partes.length > 1 ? (
                <>
                  {partes.slice(0, -1).join(" ")}{" "}
                  <span className="text-accent-300">{partes[partes.length - 1]}</span>
                </>
              ) : (
                empresa.name
              )}
            </span>
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-primary-200">
            Moda que eleva o seu dia a dia. Peças selecionadas com cuidado,
            entrega para todo o Brasil e troca fácil em 30 dias.
          </p>
          {temContato && (
            <ul className="mt-4 space-y-1 text-sm text-primary-200">
              {empresa.email && <li>{empresa.email}</li>}
              {empresa.phone && <li>{empresa.phone}</li>}
              {empresa.address && <li>{empresa.address}</li>}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-300">Loja</p>
          <ul className="mt-3 space-y-2 text-sm text-primary-200">
            <li><Link href="/produtos" className="hover:text-white">Todos os produtos</Link></li>
            {catLinks.map((c) => (
              <li key={c.href}><Link href={c.href} className="hover:text-white">{c.label}</Link></li>
            ))}
            <li><Link href="/ofertas" className="hover:text-white">Ofertas</Link></li>
            <li><Link href="/carrinho" className="hover:text-white">Carrinho</Link></li>
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-300">Ajuda</p>
          <ul className="mt-3 space-y-2 text-sm text-primary-200">
            <li><Link href="/institucional" className="hover:text-white">Sobre nós</Link></li>
            <li><Link href="/trocas" className="hover:text-white">Trocas e devoluções</Link></li>
            <li><Link href="/faq" className="hover:text-white">Perguntas frequentes</Link></li>
            <li><Link href="/privacidade" className="hover:text-white">Privacidade</Link></li>
            <li><Link href="/contato" className="hover:text-white">Contato</Link></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 py-5 text-center text-xs text-primary-300">
        © {new Date().getFullYear()} {empresa.name} — Todos os direitos reservados.
        {payment.driver === "mock" && " Pagamento em sandbox (modo dev)."}
      </div>
    </footer>
  );
}
