"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/admin", label: "Dashboard", icon: "▦" },
  { href: "/admin/produtos", label: "Produtos", icon: "◈" },
  { href: "/admin/lotes", label: "Lotes", icon: "▤" },
  { href: "/admin/precificacao", label: "Precificação", icon: "◉" },
  { href: "/admin/categorias", label: "Categorias", icon: "⊞" },
  { href: "/admin/tabelas-medidas", label: "Medidas", icon: "📏" },
  { href: "/admin/pedidos", label: "Pedidos", icon: "◉" },
  { href: "/admin/clientes", label: "Clientes", icon: "◎" },
  { href: "/admin/avaliacoes", label: "Avaliações", icon: "★" },
  { href: "/admin/cupons", label: "Cupons", icon: "%" },
  { href: "/admin/banners", label: "Banners", icon: "▣" },
  { href: "/admin/relatorios", label: "Relatórios", icon: "▤" },
  { href: "/admin/configuracoes", label: "Configurações", icon: "⚙" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (pathname.startsWith("/admin/login")) {
    return <>{children}</>;
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-primary-100/50">
      {/* Topbar mobile: hambúrguer + marca + sair */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-3 border-b border-ink/10 bg-ink px-4 py-3 text-primary-50 lg:hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 hover:bg-white/10"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {open ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
        <Link href="/admin" className="font-display text-base font-bold">
          Divine<span className="text-primary-400">Admin</span>
        </Link>
        <button
          onClick={logout}
          aria-label="Sair"
          className="ml-auto min-h-11 rounded-lg px-3 py-2 text-sm text-primary-100/70 hover:text-white"
        >
          Sair
        </button>
      </div>

      {/* Backdrop do drawer no mobile */}
      {open && (
        <button
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-ink/10 bg-ink text-primary-50 transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0"
        )}
      >
        <div className="border-b border-white/10 px-6 py-5">
          <Link href="/admin" className="font-display text-lg font-bold" onClick={() => setOpen(false)}>
            Divine<span className="text-primary-400">Admin</span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {links.map((l) => {
            const active =
              l.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-primary-700 font-semibold text-white"
                    : "text-primary-100/70 hover:bg-white/5 hover:text-white"
                )}
              >
                <span className="w-4 text-center" aria-hidden="true">{l.icon}</span>
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-white/10 px-3 py-4">
          <Link
            href="/"
            className="block rounded-lg px-3 py-2 text-sm text-primary-100/60 hover:text-white"
          >
            ↗ Ver loja
          </Link>
          <button
            onClick={logout}
            className="min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm text-primary-100/60 hover:text-white"
          >
            Sair
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 pt-14 lg:ml-60 lg:pt-0">
        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
