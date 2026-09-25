"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatBRL, formatDate, orderStatusLabel } from "@/lib/utils";
import { features } from "@/config/defaults";

type Order = {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  subtotal: string | number;
  shipping: string | number;
  discount?: string | number;
  total: string | number;
  notes?: string | null;
  trackingCode?: string | null;
  couponCode?: string | null;
  createdAt: string;
  guestName?: string | null;
  guestEmail?: string | null;
  user?: { id: string; name: string; email: string; phone?: string | null } | null;
  address?: {
    street: string;
    number: string;
    complement?: string | null;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  } | null;
  items: Array<{
    id: string;
    productName: string;
    productSlug: string;
    quantity: number;
    unitPrice: string | number;
    total: string | number;
    size?: string | null;
    color?: string | null;
  }>;
};

const nextStatuses = ["PENDING", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"];

export default function AdminPedidoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [tracking, setTracking] = useState("");

  async function load() {
    const res = await fetch(`/api/admin/pedidos/${id}`);
    if (!res.ok) {
      setError("Pedido não encontrado");
      return;
    }
    const data = await res.json();
    setOrder(data.order);
    setTracking(data.order?.trackingCode || "");
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function updateStatus(status: string) {
    if (!order) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/pedidos/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) await load();
      else alert("Erro ao atualizar");
    } finally {
      setSaving(false);
    }
  }

  async function saveTracking() {
    if (!order) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/pedidos/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: order.status, trackingCode: tracking }),
      });
      if (res.ok) await load();
      else alert("Erro ao salvar rastreio");
    } finally {
      setSaving(false);
    }
  }

  if (error)
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {error}
      </div>
    );

  if (!order) return <p className="text-ink-mute">Carregando pedido...</p>;

  const addr = order.address;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold text-ink">{order.number}</h1>
            <Badge status={order.status}>{orderStatusLabel(order.status)}</Badge>
            <Badge status={order.paymentStatus}>{orderStatusLabel(order.paymentStatus)}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-mute">{formatDate(order.createdAt)}</p>
        </div>
        <Button href="/admin/pedidos" variant="outline" size="sm">
          ← Pedidos
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border border-ink/10 bg-white p-5">
            <h2 className="font-semibold text-ink">Itens do pedido</h2>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-mute">
                  <th className="pb-2">Produto</th>
                  <th className="pb-2">Tam/Cor</th>
                  <th className="pb-2">Qtd</th>
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id} className="border-b border-ink/5 last:border-0">
                    <td className="py-3">
                      <Link href={`/produtos/${i.productSlug}`} target="_blank" className="text-ink hover:underline">
                        {i.productName}
                      </Link>
                      <p className="text-xs text-ink-mute">{formatBRL(i.unitPrice)} un.</p>
                    </td>
                    <td className="py-3 text-ink-soft">
                      {[i.size, i.color].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td className="py-3">{i.quantity}</td>
                    <td className="py-3 text-right font-medium">{formatBRL(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="mt-4 ml-auto w-full max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-mute">Subtotal</dt>
                <dd>{formatBRL(order.subtotal)}</dd>
              </div>
              {Number(order.discount || 0) > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <dt>Desconto {order.couponCode ? `(${order.couponCode})` : ""}</dt>
                  <dd>-{formatBRL(order.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-mute">Frete</dt>
                <dd>{formatBRL(order.shipping)}</dd>
              </div>
              <div className="flex justify-between border-t border-ink/10 pt-2 font-bold">
                <dt>Total</dt>
                <dd>{formatBRL(order.total)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-ink/10 bg-white p-5">
            <h2 className="font-semibold text-ink">Atualizar status</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {nextStatuses.map((s) => (
                <button
                  key={s}
                  disabled={saving || s === order.status}
                  onClick={() => updateStatus(s)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                    s === order.status
                      ? "bg-ink text-divine-50"
                      : "border border-ink/15 bg-white text-ink-soft hover:border-ink/40"
                  }`}
                >
                  {orderStatusLabel(s)}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-mute">
              Mudanças disparam e-mail mock para o cliente (log no console).
            </p>
            <div className="mt-4 flex gap-2">
              <input
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder="Código de rastreio"
                className="min-w-0 flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm"
              />
              <Button type="button" size="sm" variant="outline" disabled={saving} onClick={saveTracking}>
                Salvar rastreio
              </Button>
            </div>
            {order.trackingCode && (
              <p className="mt-2 text-xs text-ink-mute">
                Atual: <span className="font-mono">{order.trackingCode}</span>
              </p>
            )}
          </section>

          {order.notes && (
            <section className="rounded-xl border border-ink/10 bg-white p-5">
              <h2 className="font-semibold text-ink">Observações do cliente</h2>
              <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{order.notes}</p>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="rounded-xl border border-ink/10 bg-white p-5">
            <h2 className="font-semibold text-ink">Cliente</h2>
            <div className="mt-3 space-y-1 text-sm">
              <p className="font-medium text-ink">
                {order.user?.name || order.guestName || "Convidado"}
              </p>
              <p className="text-ink-mute">{order.user?.email || order.guestEmail || "—"}</p>
              {order.user?.phone && <p className="text-ink-mute">{order.user.phone}</p>}
              {!order.user && (order.guestName || order.guestEmail) && (
                <span className="inline-block rounded-full bg-divine-100 px-2 py-0.5 text-[10px] font-bold uppercase text-divine-700">
                  Convidado
                </span>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-ink/10 bg-white p-5">
            <h2 className="font-semibold text-ink">Entrega</h2>
            {addr ? (
              <address className="mt-3 text-sm not-italic leading-relaxed text-ink-soft">
                {addr.street}, {addr.number}
                {addr.complement && ` — ${addr.complement}`}
                <br />
                {addr.neighborhood}
                <br />
                {addr.city} — {addr.state}
                <br />
                CEP {addr.zipCode}
              </address>
            ) : (
              <p className="mt-3 text-sm text-ink-mute">Sem endereço.</p>
            )}
          </section>

          <section className="rounded-xl border border-ink/10 bg-white p-5">
            <h2 className="font-semibold text-ink">Pagamento</h2>
            <div className="mt-3 space-y-1 text-sm">
              <p className="text-ink-mute">
                Método: <span className="text-ink">{order.paymentMethod}</span>
              </p>
              <p className="text-ink-mute">
                Situação:{" "}
                <span className="text-ink">{orderStatusLabel(order.paymentStatus)}</span>
              </p>
            </div>
            <button
              type="button"
              disabled={!features.invoiceEmission}
              title={
                features.invoiceEmission
                  ? "Emitir nota fiscal"
                  : "Emissor fiscal pendente de definição — TODO-CLIENTE"
              }
              className="mt-4 w-full cursor-not-allowed rounded-lg border border-ink/15 bg-ink/5 px-4 py-2.5 text-sm font-semibold text-ink-mute disabled:opacity-70"
            >
              Emitir nota fiscal (em breve)
            </button>
            <p className="mt-2 text-[11px] text-ink-mute">
              Estrutura pronta — integração com emissor fiscal pendente (seção 4.4).
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
