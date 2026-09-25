"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/admin", label: "Dashboard", icon: "▦" },
  { href: "/admin/produtos", label: "Produtos", icon: "◈" },
  { href: "/admin/categorias", label: "Categorias", icon: "⊞" },
  { href: "/admin/pedidos", label: "Pedidos", icon: "◉" },
  { href: "/admin/clientes", label: "Clientes", icon: "◎" },
  { href: "/admin/cupons", label: "Cupons", icon: "%" },
  { href: "/admin/banners", label: "Banners", icon: "▣" },
  { href: "/admin/relatorios", label: "Relatórios", icon: "▤" },
  { href: "/admin/configuracoes", label: "Configurações", icon: "⚙" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname.startsWith("/admin/login")) {
    return <>{children}</>;
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-divine-100/50">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-ink/10 bg-ink text-divine-50">
        <div className="border-b border-white/10 px-6 py-5">
          <Link href="/admin" className="font-display text-lg font-bold">
            Divine<span className="text-divine-400">Admin</span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {links.map((l) => {
            const active =
              l.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-divine-600 font-semibold text-white"
                    : "text-divine-100/70 hover:bg-white/5 hover:text-white"
                )}
              >
                <span className="w-4 text-center">{l.icon}</span>
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-white/10 px-3 py-4">
          <Link
            href="/"
            className="block rounded-lg px-3 py-2 text-sm text-divine-100/60 hover:text-white"
          >
            ↗ Ver loja
          </Link>
          <button
            onClick={logout}
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-divine-100/60 hover:text-white"
          >
            Sair
          </button>
        </div>
      </aside>

      <div className="ml-60 flex-1">
        <main className="p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
