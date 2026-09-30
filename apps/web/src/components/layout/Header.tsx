"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { formatCartCount } from "@/lib/cart";
import { useCart } from "@/components/loja/CartProvider";
import { buildMenu, type MenuItem } from "@/lib/categorias";

type Session = { name: string; email: string; role: string } | null;

export function Header() {
  const [session, setSession] = useState<Session>(null);
  const [open, setOpen] = useState(false);
  const [nav, setNav] = useState<MenuItem[]>([
    { label: "Novidades", href: "/produtos" },
    { label: "Ofertas", href: "/ofertas" },
  ]);
  const pathname = usePathname();
  const router = useRouter();
  // Fonte única da quantidade: contexto do carrinho (atualiza sem reload).
  const { count: cartCount } = useCart();
  const badge = formatCartCount(cartCount);

  async function load() {
    try {
      const [meRes, catRes, offersRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/categorias"),
        fetch("/api/produtos?oferta=1&pageSize=1"),
      ]);
      if (meRes.ok) {
        const data = await meRes.json();
        setSession(data.user);
      } else {
        setSession(null);
      }
      if (catRes.ok) {
        const data = await catRes.json();
        const items = Array.isArray(data.items) ? data.items : [];
        const offers = offersRes.ok ? (await offersRes.json()).total || 0 : 0;
        setNav([
          ...buildMenu(
            items.map((c: Record<string, unknown>) => ({
              id: String(c.id),
              name: String(c.name),
              slug: String(c.slug),
              image: (c.image as string | null) ?? null,
              menuOrder: Number(c.menuOrder ?? 0),
              showInMenu: c.showInMenu !== false,
              showInHome: c.showInHome !== false,
              availableCount: Number(
                (c as { availableCount?: unknown }).availableCount ?? 0
              ),
            })),
            offers
          ),
          { label: "Sobre", href: "/institucional" },
        ]);
      }
    } catch {
      // silencioso (mantém menu fallback)
    }
  }

  useEffect(() => {
    load();
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
    router.push("/");
    router.refresh();
  }

  return (
    <header
      className="sticky top-0 z-40 border-b border-ink/10 bg-primary-50/90 backdrop-blur"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <img
            src="/logo.png"
            alt="Divine Closet"
            className="h-10 w-10 rounded-full object-cover ring-2 ring-primary-200"
          />
          <span className="font-display text-xl font-bold tracking-tight text-ink">
            Divine<span className="text-primary-700">Closet</span>
          </span>
        </Link>

        {/* --- Navegação principal (desktop) --- */}
        <nav
          className="hidden items-center gap-6 md:flex items-center"
          aria-label="Menu de navegação principal"
        >
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "text-sm text-ink-soft transition-colors hover:text-ink",
                pathname.startsWith(item.href.split("?")[0]) && "font-semibold text-ink"
              )}
              aria-current={pathname.startsWith(item.href.split("?")[0]) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* --- Grupo superior direito: mobile + desktop --- */}
        <div className="flex items-center gap-2 sm:gap-3 relative">
          {/* Botão de busca - visível apenas em mobile */}
          <button
            aria-label="Buscar"
            className="rounded-full p-2 text-ink-md md:hidden hover:bg-ink/5 transition-colors"
            onClick={() => setOpen(!open)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          </button>

          <Link
            href="/carrinho"
            className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 text-ink transition-colors hover:bg-ink/5"
            aria-label={badge ? `Carrinho, ${cartCount} itens` : "Carrinho vazio"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4H6z" />
              <path d="M3 6h18" />
              <path d="M16 10a4 4 0 01-8 0" />
            </svg>
            {badge && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-700 px-1 text-[10px] font-bold text-white">
                {badge}
              </span>
            )}
          </Link>

          {/* Conta / login - visível em desktop (sm:flex), escondido em mobile fixo */}
          {session ? (
            <div className="hidden items-center gap-2 sm:flex">
              <Link
                href="/admin"
                className="text-sm font-medium text-ink-soft hover:text-ink"
                aria-label="Painel admin"
              >
                Painel Admin
              </Link>
              <Link
                href="/conta"
                className="text-sm font-medium text-ink-soft hover:text-ink ml-4"
                aria-label="Minha conta"
              >
                Minha conta
              </Link>
            </div>
          ) : (
            <>
              <Link
                href="/login"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 text-ink hover:bg-ink/5 sm:hidden"
                aria-label="Entrar"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5" />
                </svg>
              </Link>
              <Link
                href="/login"
                className="hidden rounded-full bg-ink px-4 py-2 text-xs font-semibold text-primary-50 hover:bg-ink-soft sm:inline-flex"
                aria-label="Entrar"
              >
                Entrar
              </Link>
            </>
          )}

          {/* Botão hambúrguer - visível apenas em mobile */}
          <button
            className="rounded-full p-2 text-ink md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              {open ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-ink/10 bg-white px-4 py-4 md:hidden">
          <nav className="flex flex-col gap-3">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="text-sm text-ink-soft"
                aria-current={pathname.startsWith(item.href.split("?")[0]) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
            {session ? (
              <>
                <Link
                  href={session.role === "ADMIN" ? "/admin" : "/conta"}
                  className="text-sm font-medium"
                  aria-label={session.role === "ADMIN" ? "Painel admin" : "Minha conta"}
                >
                  Minha conta
                </Link>
                <button onClick={logout} className="text-left text-sm text-ink-mute">
                  Sair
                </button>
              </>
            ) : (
              <Link href="/login" className="text-sm font-semibold">
                Entrar / Criar conta
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
