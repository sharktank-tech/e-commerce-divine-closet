"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatBRL, formatDate, orderStatusLabel, toNumber } from "@/lib/utils";

type Dash = {
  revenue: number;
  revenueMonth: number;
  ordersMonth: number;
  ordersTotal: number;
  customers: number;
  products: number;
  pending: number;
  ticketAvg: number;
  salesSeries: Array<{ date: string; label: string; total: number }>;
  salesDemo: boolean;
  topProducts: Array<{ name: string; quantity: number }>;
  recentOrders: Array<{
    id: string;
    number: string;
    status: string;
    total: string | number;
    createdAt: string;
    user?: { name: string; email: string } | null;
    items?: Array<{ quantity: number }>;
  }>;
  lowStock: Array<{
    id: string;
    name: string;
    slug: string;
    stock: number;
    price: string | number;
    images: string[];
  }>;
  statusCounts: Record<string, number>;
};

// Dataset de demonstração enquanto não há movimentação (seção 4.2).
const DEMO_SALES = [180, 320, 240, 410, 290, 520, 380, 450, 310, 600, 470, 540, 420, 680];

function SalesChart({ series, demo }: { series: Dash["salesSeries"]; demo: boolean }) {
  const values = demo ? DEMO_SALES : series.map((s) => s.total);
  const labels = demo ? series.map((s) => s.label) : series.map((s) => s.label);
  const max = Math.max(...values, 1);
  const w = 640;
  const h = 170;
  const padX = 10;
  const padY = 14;
  const pts = values.map((v, i) => {
    const x = padX + (i / Math.max(1, values.length - 1)) * (w - padX * 2);
    const y = h - padY - (v / max) * (h - padY * 2);
    return [x, y] as const;
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Vendas por dia">
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={padX}
            x2={w - padX}
            y1={padY + f * (h - padY * 2)}
            y2={padY + f * (h - padY * 2)}
            stroke="#e5e2dc"
            strokeWidth="1"
          />
        ))}
        <polyline
          d={path}
          fill="none"
          stroke="#B08D57"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#9E2BBA" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-mute">
        {labels.map((l, i) => (
          <span key={i}>{i % 2 === 0 ? l : ""}</span>
        ))}
      </div>
    </div>
  );
}

function TopProductsChart({ data, demo }: { data: Dash["topProducts"]; demo: boolean }) {
  const rows = demo && data.length === 0
    ? [
        { name: "Vestido Midi Floral", quantity: 14 },
        { name: "Blusa Canelada Off-White", quantity: 11 },
        { name: "Calça Wide Leg Alfaiataria", quantity: 9 },
        { name: "Saia Plissada Dourada", quantity: 7 },
        { name: "Trench Coat Clássico", quantity: 5 },
      ]
    : data;
  const max = Math.max(...rows.map((r) => r.quantity), 1);

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-mute">Sem vendas registradas ainda.</p>;
  }

  return (
    <ul className="mt-4 space-y-3">
      {rows.map((r) => (
        <li key={r.name}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-ink-soft">{r.name}</span>
            <span className="shrink-0 font-semibold text-ink">{r.quantity} un</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-ink/5">
            <div
              className="h-2 rounded-full bg-primary-700"
              style={{ width: `${Math.max(4, (r.quantity / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function AdminDashboard() {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/dashboard")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar"))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {error}. Verifique o banco de dados e as migrações.
      </div>
    );
  }

  if (!data) return <p className="text-ink-mute">Carregando dashboard...</p>;

  const cards = [
    { label: "Receita total", value: formatBRL(data.revenue) },
    { label: "Receita (mês)", value: formatBRL(data.revenueMonth) },
    { label: "Ticket médio", value: formatBRL(data.ticketAvg || 0) },
    { label: "Pedidos (mês)", value: String(data.ordersMonth) },
    { label: "Pedidos pendentes", value: String(data.pending) },
    { label: "Clientes", value: String(data.customers) },
    { label: "Produtos ativos", value: String(data.products) },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Dashboard</h1>
        <p className="text-sm text-ink-mute">Visão geral da loja</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-ink/10 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-mute">{c.label}</p>
            <p className="mt-1 text-xl font-bold text-ink">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-ink/10 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-ink">Vendas — últimos 14 dias</h2>
            {data.salesDemo && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                Dados de demonstração
              </span>
            )}
          </div>
          <div className="mt-4">
            <SalesChart series={data.salesSeries} demo={data.salesDemo} />
          </div>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white p-5">
          <h2 className="font-semibold text-ink">Produtos mais vendidos</h2>
          <TopProductsChart data={data.topProducts} demo={data.salesDemo} />
        </div>

        <div className="rounded-xl border border-ink/10 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-ink">Estoque baixo</h2>
            <Link href="/admin/produtos" className="text-xs font-semibold text-divine-700 hover:underline">
              Gerenciar →
            </Link>
          </div>
          <ul className="mt-4 space-y-3">
            {data.lowStock.length === 0 && (
              <li className="text-sm text-ink-mute">Nenhum item crítico. 🎉</li>
            )}
            {data.lowStock.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                <Link href={`/admin/produtos/${p.id}`} className="truncate text-ink hover:underline">
                  {p.name}
                </Link>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                    p.stock === 0
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {p.stock} un
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-6 border-t border-ink/10 pt-4">
            <p className="text-xs uppercase tracking-wide text-ink-mute">Pedidos por status</p>
            <div className="mt-2 space-y-1.5">
              {Object.entries(data.statusCounts).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between text-sm">
                  <Badge status={status}>{orderStatusLabel(status)}</Badge>
                  <span className="font-semibold">{count}</span>
                </div>
              ))}
              {Object.keys(data.statusCounts).length === 0 && (
                <p className="text-sm text-ink-mute">Sem dados.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-ink/10 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-ink">Pedidos recentes</h2>
            <Link href="/admin/pedidos" className="text-xs font-semibold text-divine-700 hover:underline">
              Ver todos →
            </Link>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-mute">
                  <th className="pb-2 pr-3">Pedido</th>
                  <th className="pb-2 pr-3">Cliente</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Total</th>
                  <th className="pb-2">Data</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-ink-mute">
                      Nenhum pedido ainda.
                    </td>
                  </tr>
                )}
                {data.recentOrders.map((o) => (
                  <tr key={o.id} className="border-b border-ink/5 last:border-0">
                    <td className="py-3 pr-3">
                      <Link href={`/admin/pedidos/${o.id}`} className="font-medium text-ink hover:underline">
                        {o.number}
                      </Link>
                    </td>
                    <td className="py-3 pr-3 text-ink-soft">{o.user?.name || "—"}</td>
                    <td className="py-3 pr-3">
                      <Badge status={o.status}>{orderStatusLabel(o.status)}</Badge>
                    </td>
                    <td className="py-3 pr-3 font-medium">{formatBRL(o.total)}</td>
                    <td className="py-3 text-xs text-ink-mute">{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
    </div>
  );
}
