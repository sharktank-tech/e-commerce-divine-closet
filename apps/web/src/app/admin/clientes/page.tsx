"use client";

import { useEffect, useState } from "react";
import { formatBRL, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";

type Customer = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  active: boolean;
  createdAt: string;
  ordersCount: number;
  totalSpent: number;
  lastOrder?: { status: string } | null;
  segment: "novo" | "recorrente" | "inativo";
};

const SEGMENTS = [
  { id: "todos", label: "Todos" },
  { id: "novo", label: "Novos" },
  { id: "recorrente", label: "Recorrentes" },
  { id: "inativo", label: "Inativos" },
] as const;

const segmentBadge: Record<Customer["segment"], { status: string; label: string }> = {
  novo: { status: "ACTIVE", label: "Novo" },
  recorrente: { status: "PAID", label: "Recorrente" },
  inativo: { status: "HIDDEN", label: "Inativo" },
};

export default function AdminClientesPage() {
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]["id"]>("todos");

  useEffect(() => {
    fetch("/api/admin/clientes")
      .then((r) => r.json())
      .then((d) => setItems(d.items || []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = items.filter(
    (c) =>
      (segment === "todos" || c.segment === segment) &&
      (c.name.toLowerCase().includes(q.toLowerCase()) ||
        c.email.toLowerCase().includes(q.toLowerCase()))
  );

  const counts = {
    todos: items.length,
    novo: items.filter((c) => c.segment === "novo").length,
    recorrente: items.filter((c) => c.segment === "recorrente").length,
    inativo: items.filter((c) => c.segment === "inativo").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Clientes</h1>
          <p className="text-sm text-ink-mute">{items.length} cadastrado(s)</p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome ou e-mail..."
          className="rounded-full border border-ink/15 bg-white px-4 py-2 text-sm outline-none"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {SEGMENTS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSegment(s.id)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
              segment === s.id
                ? "bg-ink text-primary-50"
                : "border border-ink/10 bg-white text-ink-soft"
            }`}
          >
            {s.label} ({counts[s.id]})
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-primary-50">
              <tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-mute">
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Segmento</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">Pedidos</th>
                <th className="px-4 py-3">Total gasto</th>
                <th className="px-4 py-3">Último pedido</th>
                <th className="px-4 py-3">Cadastro</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink-mute">
                    Carregando...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink-mute">
                    Nenhum cliente encontrado.
                  </td>
                </tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-ink/5 last:border-0 hover:bg-primary-50/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{c.name}</p>
                    <p className="text-xs text-ink-mute">{c.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge status={segmentBadge[c.segment].status}>
                      {segmentBadge[c.segment].label}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{c.phone || "—"}</td>
                  <td className="px-4 py-3">{c.ordersCount}</td>
                  <td className="px-4 py-3 font-medium">{formatBRL(c.totalSpent)}</td>
                  <td className="px-4 py-3">
                    {c.lastOrder ? (
                      <Badge status={c.lastOrder.status}>{c.lastOrder.status}</Badge>
                    ) : (
                      <span className="text-ink-mute">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-mute">{formatDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
