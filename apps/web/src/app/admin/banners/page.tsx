"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

type Banner = {
  id: string;
  title: string;
  subtitle?: string | null;
  imageUrl: string;
  linkUrl?: string | null;
  position: number;
  status: "ACTIVE" | "HIDDEN";
};

const empty = { title: "", subtitle: "", imageUrl: "", linkUrl: "", position: "0" };

export default function AdminBannersPage() {
  const [items, setItems] = useState<Banner[]>([]);
  const [form, setForm] = useState({ ...empty });
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);

  async function load() {
    const res = await fetch("/api/admin/banners");
    if (res.ok) setItems((await res.json()).items || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no upload");
      setForm((f) => ({ ...f, imageUrl: data.url }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const payload = {
      title: form.title,
      subtitle: form.subtitle || null,
      imageUrl: form.imageUrl,
      linkUrl: form.linkUrl || null,
      position: Number(form.position) || 0,
    };
    const res = await fetch(
      editing ? `/api/admin/banners/${editing}` : "/api/admin/banners",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "Erro ao salvar");
      return;
    }
    setForm({ ...empty });
    setEditing(null);
    setMsg(editing ? "Banner atualizado." : "Banner criado.");
    load();
  }

  async function toggle(b: Banner) {
    await fetch(`/api/admin/banners/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: b.status === "ACTIVE" ? "HIDDEN" : "ACTIVE" }),
    });
    load();
  }

  async function remove(b: Banner) {
    if (!confirm(`Excluir o banner "${b.title}"?`)) return;
    await fetch(`/api/admin/banners/${b.id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((x) => x.id !== b.id));
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Banners da home</h1>
        <p className="text-sm text-ink-mute">
          Carrossel da página inicial. // TODO-CLIENTE: artes promocionais reais
        </p>
      </div>

      <form onSubmit={save} className="rounded-xl border border-ink/10 bg-white p-5">
        <p className="font-semibold text-ink">{editing ? "Editar banner" : "Novo banner"}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input label="Título" required value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} />
          <Input label="Subtítulo" value={form.subtitle} onChange={(v) => setForm((f) => ({ ...f, subtitle: v }))} />
          <Input label="URL do link (opcional)" value={form.linkUrl} onChange={(v) => setForm((f) => ({ ...f, linkUrl: v }))} placeholder="/produtos" />
          <Input label="Posição" type="number" min="0" value={form.position} onChange={(v) => setForm((f) => ({ ...f, position: v }))} />
          <div className="sm:col-span-2 flex items-end gap-3">
            <label className="cursor-pointer rounded-lg border border-ink/15 px-3 py-2 text-xs font-semibold text-ink-soft hover:border-ink/30">
              {uploading ? "Enviando..." : "Enviar imagem"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                }}
              />
            </label>
            {form.imageUrl && (
              <div className="h-12 w-20 overflow-hidden rounded border border-ink/10">
                <img src={form.imageUrl} alt="" className="h-full w-full object-cover" />
              </div>
            )}
          </div>
        </div>
        {msg && <p className="mt-2 text-xs text-ink-soft">{msg}</p>}
        <div className="mt-3 flex gap-2">
          <Button type="submit" size="sm" disabled={!form.imageUrl || uploading}>
            {editing ? "Salvar" : "Criar"}
          </Button>
          {editing && (
            <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(null); setForm({ ...empty }); }}>
              Cancelar
            </Button>
          )}
        </div>
      </form>

      <div className="space-y-3">
        {items.length === 0 && (
          <p className="rounded-xl border border-ink/10 bg-white p-6 text-sm text-ink-mute">
            Nenhum banner cadastrado — a home usa o placeholder.
          </p>
        )}
        {items.map((b) => (
          <div key={b.id} className="flex items-center gap-4 rounded-xl border border-ink/10 bg-white p-4">
            <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-divine-100">
              {b.imageUrl && <img src={b.imageUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{b.title}</p>
              <p className="truncate text-xs text-ink-mute">{b.subtitle || "—"}</p>
            </div>
            <Badge status={b.status === "ACTIVE" ? "ACTIVE" : "HIDDEN"}>
              {b.status === "ACTIVE" ? "Visível" : "Oculto"}
            </Badge>
            <div className="flex gap-3 text-xs">
              <button
                onClick={() => {
                  setEditing(b.id);
                  setForm({
                    title: b.title,
                    subtitle: b.subtitle || "",
                    imageUrl: b.imageUrl,
                    linkUrl: b.linkUrl || "",
                    position: String(b.position),
                  });
                }}
                className="font-semibold text-divine-700 hover:underline"
              >
                Editar
              </button>
              <button onClick={() => toggle(b)} className="text-ink-mute hover:underline">
                {b.status === "ACTIVE" ? "Ocultar" : "Ativar"}
              </button>
              <button onClick={() => remove(b)} className="text-red-600 hover:underline">
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
