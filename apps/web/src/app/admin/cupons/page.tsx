"use client";

import { useEffect, useState } from "react";

type Coupon = {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED" | "FREE_SHIPPING";
  value: number | string;
  minSubtotal: number | string | null;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  endsAt: string | null;
};

export default function AdminCuponsPage() {
  const [items, setItems] = useState<Coupon[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    code: "",
    type: "PERCENT" as Coupon["type"],
    value: "10",
    minSubtotal: "",
    maxUses: "",
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/admin/cupons");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Erro ao carregar");
      return;
    }
    setItems(data.items || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/cupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          type: form.type,
          value: Number(form.value) || 0,
          minSubtotal: form.minSubtotal ? Number(form.minSubtotal) : null,
          maxUses: form.maxUses ? Number(form.maxUses) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao criar");
        return;
      }
      setForm({ code: "", type: "PERCENT", value: "10", minSubtotal: "", maxUses: "" });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/admin/cupons/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primary">Cupons</h1>
        <p className="mt-1 text-sm text-ink-mute">
          Percentual, valor fixo ou frete grátis. {/* TODO-CLIENTE: campanhas reais */}
        </p>
      </div>

      <form onSubmit={create} className="grid gap-3 rounded-xl border border-ink/10 bg-white p-5 sm:grid-cols-6">
        <input
          className="rounded-lg border border-ink/15 px-3 py-2 text-sm uppercase sm:col-span-2"
          placeholder="CÓDIGO"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          required
        />
        <select
          className="rounded-lg border border-ink/15 px-3 py-2 text-sm"
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value as Coupon["type"] })}
        >
          <option value="PERCENT">Percentual</option>
          <option value="FIXED">Valor fixo</option>
          <option value="FREE_SHIPPING">Frete grátis</option>
        </select>
        <input
          className="rounded-lg border border-ink/15 px-3 py-2 text-sm"
          placeholder="Valor"
          value={form.value}
          onChange={(e) => setForm({ ...form, value: e.target.value })}
          disabled={form.type === "FREE_SHIPPING"}
        />
        <input
          className="rounded-lg border border-ink/15 px-3 py-2 text-sm"
          placeholder="Mín. subtotal"
          value={form.minSubtotal}
          onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })}
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Criar"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink/10 text-xs uppercase text-ink-mute">
            <tr>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Valor</th>
              <th className="px-4 py-3">Usos</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-b border-ink/5">
                <td className="px-4 py-3 font-mono font-semibold">{c.code}</td>
                <td className="px-4 py-3">{c.type}</td>
                <td className="px-4 py-3">
                  {c.type === "FREE_SHIPPING"
                    ? "Frete grátis"
                    : c.type === "PERCENT"
                      ? `${c.value}%`
                      : `R$ ${c.value}`}
                </td>
                <td className="px-4 py-3">
                  {c.usedCount}
                  {c.maxUses ? ` / ${c.maxUses}` : ""}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      c.active ? "bg-emerald-100 text-emerald-800" : "bg-ink/10 text-ink-mute"
                    }`}
                  >
                    {c.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => remove(c.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-mute">
                  Nenhum cupom.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
