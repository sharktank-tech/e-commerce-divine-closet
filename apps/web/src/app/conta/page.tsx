"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ProductCard } from "@/components/loja/ProductCard";
import { features } from "@/config/defaults";
import { formatDate, orderStatusLabel } from "@/lib/utils";
import { formatBRL } from "@/lib/utils";

type Session = { name: string; email: string; role: string; phone?: string };
type Order = {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  total: string | number;
  createdAt: string;
  items: Array<{ id: string; productName: string; quantity: number; size?: string | null }>;
};
type Address = {
  id: string;
  label: string;
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  isDefault: boolean;
};
type WishProduct = React.ComponentProps<typeof ProductCard>["product"];

const emptyAddress = {
  label: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  zipCode: "",
};

function ContaContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [session, setSession] = useState<Session | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(params.get("tab") || "pedidos");

  const [form, setForm] = useState({ name: "", phone: "" });
  const [pwd, setPwd] = useState({ current: "", next: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addrForm, setAddrForm] = useState({ ...emptyAddress });
  const [addrEditing, setAddrEditing] = useState<string | null>(null);
  const [addrMsg, setAddrMsg] = useState("");

  const [wishlist, setWishlist] = useState<WishProduct[]>([]);

  useEffect(() => {
    async function load() {
      const me = await fetch("/api/auth/me");
      if (!me.ok) {
        router.replace("/login?next=/conta");
        return;
      }
      const data = await me.json();
      setSession(data.user);
      setForm({ name: data.user.name || "", phone: data.user.phone || "" });

      const [ord, add] = await Promise.all([fetch("/api/pedidos"), fetch("/api/enderecos")]);
      if (ord.ok) {
        const o = await ord.json();
        setOrders(o.orders || []);
      }
      if (add.ok) {
        const a = await add.json();
        setAddresses(a.addresses || []);
      }
      if (features.wishlist) {
        const w = await fetch("/api/wishlist");
        if (w.ok) {
          const wd = await w.json();
          setWishlist(wd.items || []);
        }
      }
      setLoading(false);
    }
    load();
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setErr("");
    setSaving(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone || null,
          ...(pwd.next
            ? { currentPassword: pwd.current, newPassword: pwd.next }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "Erro ao salvar");
        return;
      }
      setPwd({ current: "", next: "" });
      setMsg("Dados atualizados com sucesso.");
      setSession((s) => (s ? { ...s, name: data.user.name, phone: data.user.phone || "" } : s));
    } catch {
      setErr("Erro de conexão");
    } finally {
      setSaving(false);
    }
  }

  async function saveAddress(e: React.FormEvent) {
    e.preventDefault();
    setAddrMsg("");
    try {
      const res = await fetch(
        addrEditing ? `/api/enderecos/${addrEditing}` : "/api/enderecos",
        {
          method: addrEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(addrForm),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setAddrMsg(data.error || "Erro ao salvar endereço");
        return;
      }
      const list = await fetch("/api/enderecos");
      if (list.ok) setAddresses((await list.json()).addresses || []);
      setAddrForm({ ...emptyAddress });
      setAddrEditing(null);
      setAddrMsg("Endereço salvo.");
    } catch {
      setAddrMsg("Erro de conexão");
    }
  }

  async function removeAddress(id: string) {
    if (!confirm("Remover este endereço?")) return;
    await fetch(`/api/enderecos/${id}`, { method: "DELETE" });
    setAddresses((a) => a.filter((x) => x.id !== id));
  }

  if (loading) {
    return <div className="mx-auto max-w-4xl px-4 py-16 text-center text-ink-mute">Carregando...</div>;
  }

  const tabs = [
    { id: "pedidos", label: "Meus pedidos" },
    { id: "dados", label: "Meus dados" },
    { id: "enderecos", label: "Endereços" },
    ...(features.wishlist ? [{ id: "desejos", label: "Lista de desejos" }] : []),
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 pb-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Minha conta</h1>
          <p className="mt-1 text-sm text-ink-mute">
            {session?.name} — {session?.email}
          </p>
        </div>
        <div className="flex gap-2">
          <Button href="/produtos" variant="outline" size="sm">
            Continuar comprando
          </Button>
          <Button variant="ghost" size="sm" onClick={logout}>
            Sair
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              tab === t.id ? "bg-ink text-divine-50" : "bg-white text-ink-soft border border-ink/10"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "pedidos" && (
        <div className="mt-6 space-y-4">
          {orders.length === 0 ? (
            <div className="rounded-xl border border-ink/10 bg-white p-10 text-center">
              <p className="font-medium text-ink">Nenhum pedido ainda</p>
              <p className="mt-1 text-sm text-ink-mute">Suas compras aparecerão aqui.</p>
              <Button href="/produtos" className="mt-5">
                Explorar coleção
              </Button>
            </div>
          ) : (
            orders.map((o) => (
              <div key={o.id} className="rounded-xl border border-ink/10 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{o.number}</p>
                    <p className="text-xs text-ink-mute">{formatDate(o.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge status={o.status}>{orderStatusLabel(o.status)}</Badge>
                    <span className="font-bold text-ink">{formatBRL(o.total)}</span>
                  </div>
                </div>
                <ul className="mt-3 space-y-1 border-t border-ink/5 pt-3 text-sm text-ink-mute">
                  {o.items.map((i) => (
                    <li key={i.id}>
                      {i.quantity}× {i.productName}
                      {i.size && ` — Tam ${i.size}`}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "dados" && (
        <form onSubmit={saveProfile} className="mt-6 space-y-6 rounded-xl border border-ink/10 bg-white p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Nome" required value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
            <Input label="Telefone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="(11) 99999-0000" />
            <Input label="E-mail" value={session?.email || ""} disabled />
          </div>

          <div className="border-t border-ink/10 pt-4">
            <p className="text-sm font-semibold text-ink">Alterar senha</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Input label="Senha atual" type="password" value={pwd.current} onChange={(v) => setPwd((p) => ({ ...p, current: v }))} />
              <Input label="Nova senha (mín. 6)" type="password" value={pwd.next} onChange={(v) => setPwd((p) => ({ ...p, next: v }))} />
            </div>
          </div>

          {msg && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{msg}</p>}
          {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}

          <div className="flex items-center justify-between">
            {session?.role === "ADMIN" && (
              <Link href="/admin" className="text-sm font-semibold text-divine-700 underline">
                Painel admin →
              </Link>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Salvar alterações"}
            </Button>
          </div>
        </form>
      )}

      {tab === "enderecos" && (
        <div className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {addresses.map((a) => (
              <div key={a.id} className="rounded-xl border border-ink/10 bg-white p-5 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-ink">{a.label}</p>
                  {a.isDefault && (
                    <span className="rounded-full bg-divine-100 px-2 py-0.5 text-[11px] font-semibold text-divine-700">
                      Padrão
                    </span>
                  )}
                </div>
                <p className="mt-2 text-ink-soft">
                  {a.street}, {a.number} {a.complement && `— ${a.complement}`}
                </p>
                <p className="text-ink-soft">
                  {a.neighborhood} — {a.city}/{a.state}
                </p>
                <p className="text-ink-mute">CEP {a.zipCode}</p>
                <div className="mt-3 flex gap-3 text-xs font-semibold">
                  <button
                    type="button"
                    className="text-divine-700 underline"
                    onClick={() => {
                      setAddrEditing(a.id);
                      setAddrForm({
                        label: a.label,
                        street: a.street,
                        number: a.number,
                        complement: a.complement || "",
                        neighborhood: a.neighborhood,
                        city: a.city,
                        state: a.state,
                        zipCode: a.zipCode,
                      });
                    }}
                  >
                    Editar
                  </button>
                  <button type="button" className="text-red-600 underline" onClick={() => removeAddress(a.id)}>
                    Remover
                  </button>
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={saveAddress} className="rounded-xl border border-ink/10 bg-white p-6">
            <p className="font-display text-lg font-bold text-ink">
              {addrEditing ? "Editar endereço" : "Novo endereço"}
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-6">
              <div className="sm:col-span-2">
                <Input label="Apelido" value={addrForm.label} onChange={(v) => setAddrForm((f) => ({ ...f, label: v }))} placeholder="Casa" />
              </div>
              <div className="sm:col-span-4">
                <Input label="Rua" required value={addrForm.street} onChange={(v) => setAddrForm((f) => ({ ...f, street: v }))} />
              </div>
              <div className="sm:col-span-2">
                <Input label="Número" required value={addrForm.number} onChange={(v) => setAddrForm((f) => ({ ...f, number: v }))} />
              </div>
              <div className="sm:col-span-2">
                <Input label="Complemento" value={addrForm.complement} onChange={(v) => setAddrForm((f) => ({ ...f, complement: v }))} />
              </div>
              <div className="sm:col-span-2">
                <Input label="Bairro" required value={addrForm.neighborhood} onChange={(v) => setAddrForm((f) => ({ ...f, neighborhood: v }))} />
              </div>
              <div className="sm:col-span-3">
                <Input label="Cidade" required value={addrForm.city} onChange={(v) => setAddrForm((f) => ({ ...f, city: v }))} />
              </div>
              <div className="sm:col-span-1">
                <Input label="UF" required maxLength={2} value={addrForm.state} onChange={(v) => setAddrForm((f) => ({ ...f, state: v.toUpperCase() }))} />
              </div>
              <div className="sm:col-span-2">
                <Input label="CEP" required placeholder="00000-000" value={addrForm.zipCode} onChange={(v) => setAddrForm((f) => ({ ...f, zipCode: v }))} />
              </div>
            </div>
            {addrMsg && <p className="mt-3 text-sm text-ink-soft">{addrMsg}</p>}
            <div className="mt-4 flex gap-2">
              <Button type="submit">{addrEditing ? "Salvar" : "Adicionar"}</Button>
              {addrEditing && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setAddrEditing(null);
                    setAddrForm({ ...emptyAddress });
                  }}
                >
                  Cancelar
                </Button>
              )}
            </div>
          </form>
        </div>
      )}

      {tab === "desejos" && (
        <div className="mt-6">
          {wishlist.length === 0 ? (
            <div className="rounded-xl border border-ink/10 bg-white p-10 text-center">
              <p className="font-medium text-ink">Sua lista de desejos está vazia</p>
              <p className="mt-1 text-sm text-ink-mute">
                Toque no coração nos produtos para salvá-los aqui.
              </p>
              <Button href="/produtos" className="mt-5">
                Explorar coleção
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {wishlist.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ContaPage() {
  return (
    <Suspense>
      <ContaContent />
    </Suspense>
  );
}
