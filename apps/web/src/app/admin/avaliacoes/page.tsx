"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

type Review = {
  id: string;
  rating: number;
  titulo?: string | null;
  comment: string;
  tamanhoComprado?: string | null;
  caimento?: string | null;
  alturaCliente?: string | null;
  status: "PENDENTE" | "APROVADA" | "REJEITADA";
  respostaLoja?: string | null;
  createdAt: string;
  user: { name: string; email: string };
  product: { name: string; slug: string };
  order: { number: string };
  fotos: { url: string }[];
};

const TABS = [
  { id: "", label: "Todas" },
  { id: "PENDENTE", label: "Pendentes" },
  { id: "APROVADA", label: "Aprovadas" },
  { id: "REJEITADA", label: "Rejeitadas" },
] as const;

export default function AdminAvaliacoesPage() {
  const [tab, setTab] = useState<string>("");
  const [items, setItems] = useState<Review[]>([]);
  const [pendentes, setPendentes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  async function load(status = tab) {
    setLoading(true);
    const res = await fetch(`/api/admin/avaliacoes${status ? `?status=${status}` : ""}`);
    if (res.ok) {
      const data = await res.json();
      setItems(data.items || []);
      setPendentes(data.pendentes || 0);
      const init: Record<string, string> = {};
      for (const r of data.items || []) init[r.id] = r.respostaLoja || "";
      setReplies(init);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeTab(id: string) {
    setTab(id);
    load(id);
  }

  async function setStatus(id: string, status: Review["status"]) {
    const res = await fetch(`/api/admin/avaliacoes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setMsg(`Avaliação ${status === "APROVADA" ? "aprovada" : status === "REJEITADA" ? "rejeitada" : "devolvida"} .`);
      load();
    }
  }

  async function saveReply(id: string) {
    const res = await fetch(`/api/admin/avaliacoes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ respostaLoja: replies[id] || null }),
    });
    if (res.ok) {
      setMsg("Resposta salva.");
      load();
    }
  }

  async function remove(id: string) {
    if (!confirm("Excluir esta avaliação?")) return;
    const res = await fetch(`/api/admin/avaliacoes/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">
          Avaliações{" "}
          {pendentes > 0 && (
            <span className="ml-2 rounded-full bg-amber-100 px-2.5 py-0.5 align-middle text-xs font-bold text-amber-800">
              {pendentes} pendente{pendentes === 1 ? "" : "s"}
            </span>
          )}
        </h1>
        <p className="text-sm text-ink-mute">Moderação e respostas da loja.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => changeTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
              tab === t.id ? "bg-ink text-primary-50" : "border border-ink/10 bg-white text-ink-soft"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {msg && <p className="text-xs text-ink-soft">{msg}</p>}

      <div className="space-y-4">
        {loading && <p className="text-sm text-ink-mute">Carregando...</p>}
        {!loading && items.length === 0 && (
          <p className="rounded-xl border border-ink/10 bg-white p-6 text-center text-sm text-ink-mute">
            Nenhuma avaliação aqui.
          </p>
        )}
        {items.map((r) => (
          <article key={r.id} className="rounded-xl border border-ink/10 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold text-ink">{"★".repeat(r.rating)}</span>
              <span className="font-semibold text-ink">{r.user.name}</span>
              <span className="text-xs text-ink-mute">{r.user.email}</span>
              <Badge status={r.status === "APROVADA" ? "ACTIVE" : r.status === "PENDENTE" ? "PENDING" : "HIDDEN"}>
                {r.status}
              </Badge>
              <span className="ml-auto text-xs text-ink-mute">
                {r.product.name} · pedido {r.order.number}
              </span>
            </div>
            {r.titulo && <p className="mt-2 text-sm font-semibold text-ink">{r.titulo}</p>}
            <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{r.comment}</p>
            {(r.tamanhoComprado || r.caimento || r.alturaCliente) && (
              <p className="mt-1 text-xs text-ink-mute">
                {[r.tamanhoComprado && `Tam: ${r.tamanhoComprado}`, r.caimento && `Caimento: ${r.caimento}`, r.alturaCliente && `Altura: ${r.alturaCliente}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {r.fotos.length > 0 && (
              <div className="mt-2 flex gap-2">
                {r.fotos.map((f, i) => (
                  <img key={i} src={f.url} alt="" className="h-14 w-14 rounded-lg border border-ink/10 object-cover" />
                ))}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <input
                value={replies[r.id] || ""}
                onChange={(e) => setReplies((s) => ({ ...s, [r.id]: e.target.value }))}
                placeholder="Responder como loja (opcional)"
                className="flex-1 rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-xs outline-none"
              />
              <Button size="sm" variant="outline" onClick={() => saveReply(r.id)}>
                Responder
              </Button>
            </div>
            <div className="mt-2 flex gap-3 text-xs">
              <button onClick={() => setStatus(r.id, "APROVADA")} className="font-semibold text-emerald-700 hover:underline">
                Aprovar
              </button>
              <button onClick={() => setStatus(r.id, "REJEITADA")} className="font-semibold text-amber-700 hover:underline">
                Rejeitar
              </button>
              <button onClick={() => remove(r.id)} className="text-red-600 hover:underline">
                Excluir
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
