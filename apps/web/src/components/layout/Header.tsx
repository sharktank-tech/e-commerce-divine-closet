"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Session = { name: string; email: string; role: string } | null;

const nav = [
  { href: "/produtos", label: "Coleção" },
  { href: "/produtos?categoria=vestidos", label: "Vestidos" },
  { href: "/produtos?categoria=conjuntos", label: "Conjuntos" },
  { href: "/produtos?categoria=acessorios", label: "Acessórios" },
  { href: "/institucional", label: "Sobre" },
];

export function Header() {
  const [session, setSession] = useState<Session>(null);
  const [cartCount, setCartCount] = useState(0);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  async function load() {
    try {
      const [meRes, cartRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/carrinho"),
      ]);
      if (meRes.ok) {
        const data = await meRes.json();
        setSession(data.user);
      } else {
        setSession(null);
      }
      if (cartRes.ok) {
        const cart = await cartRes.json();
        setCartCount(cart.count || 0);
      }
    } catch {
      // silencioso
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
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-primary-50/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="font-display text-xl font-bold tracking-tight text-ink">
          Divine<span className="text-primary-700">Closet</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "text-sm text-ink-soft transition-colors hover:text-ink",
                pathname.startsWith(item.href.split("?")[0]) && "font-semibold text-ink"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/carrinho"
            className="relative rounded-full p-2 text-ink transition-colors hover:bg-ink/5"
            aria-label="Carrinho"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4H6z" />
              <path d="M3 6h18" />
              <path d="M16 10a4 4 0 01-8 0" />
            </svg>
            {cartCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-700 px-1 text-[10px] font-bold text-white">
                {cartCount}
              </span>
            )}
          </Link>

          {session ? (
            <div className="hidden items-center gap-2 sm:flex">
              <Link
                href={session.role === "ADMIN" ? "/admin" : "/conta"}
                className="text-sm font-medium text-ink-soft hover:text-ink"
              >
                {session.name.split(" ")[0]}
              </Link>
              <button
                onClick={logout}
                className="text-xs text-ink-mute hover:text-ink"
              >
                Sair
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="hidden rounded-full bg-ink px-4 py-2 text-xs font-semibold text-primary-50 hover:bg-ink-soft sm:inline-flex"
            >
              Entrar
            </Link>
          )}

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
              >
                {item.label}
              </Link>
            ))}
            {session ? (
              <>
                <Link href={session.role === "ADMIN" ? "/admin" : "/conta"} className="text-sm font-medium">
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
