"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatBRL, formatDate, orderStatusLabel } from "@/lib/utils";

type Order = {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  total: string | number;
  createdAt: string;
  user?: { name: string; email: string } | null;
  items?: Array<{ quantity: number; productName: string }>;
};

const statuses = ["", "PENDING", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];

export default function AdminPedidosPage() {
  const [items, setItems] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setLoading(true);
    const url = status ? `/api/admin/pedidos?status=${status}` : "/api/admin/pedidos";
    fetch(url)
      .then((r) => r.json())
      .then((d) => setItems(d.items || []))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Pedidos</h1>
          <p className="text-sm text-ink-mute">{items.length} pedido(s)</p>
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-full border border-ink/15 bg-white px-4 py-2 text-sm outline-none"
        >
          <option value="">Todos os status</option>
          {statuses.filter(Boolean).map((s) => (
            <option key={s} value={s}>
              {orderStatusLabel(s)}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-divine-50">
              <tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-mute">
                <th className="px-4 py-3">Pedido</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Itens</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Pagamento</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Data</th>
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
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink-mute">
                    Nenhum pedido encontrado.
                  </td>
                </tr>
              )}
              {items.map((o) => (
                <tr key={o.id} className="border-b border-ink/5 last:border-0 hover:bg-divine-50/50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/pedidos/${o.id}`} className="font-medium text-ink hover:underline">
                      {o.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{o.user?.name || "—"}</p>
                    <p className="text-xs text-ink-mute">{o.user?.email}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">
                    {(o.items || []).reduce((s, i) => s + i.quantity, 0)} un.
                  </td>
                  <td className="px-4 py-3">
                    <Badge status={o.status}>{orderStatusLabel(o.status)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge status={o.paymentStatus}>{orderStatusLabel(o.paymentStatus)}</Badge>
                  </td>
                  <td className="px-4 py-3 font-medium">{formatBRL(o.total)}</td>
                  <td className="px-4 py-3 text-xs text-ink-mute">{formatDate(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
