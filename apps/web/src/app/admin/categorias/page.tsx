"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

type Category = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  status: "ACTIVE" | "HIDDEN";
  parentId?: string | null;
  _count?: { products: number };
};

export default function AdminCategoriasPage() {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<Category | null>(null);

  async function load() {
    const res = await fetch("/api/admin/categorias");
    if (res.ok) setItems((await res.json()).items || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch(
      editing ? `/api/admin/categorias/${editing.id}` : "/api/admin/categorias",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || null }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "Erro ao salvar");
      return;
    }
    setName("");
    setDescription("");
    setEditing(null);
    setMsg(editing ? "Categoria atualizada." : "Categoria criada.");
    load();
  }

  async function remove(c: Category) {
    if (!confirm(`Excluir a categoria "${c.name}"?`)) return;
    const res = await fetch(`/api/admin/categorias/${c.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Erro ao excluir");
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== c.id));
  }

  async function toggleStatus(c: Category) {
    await fetch(`/api/admin/categorias/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: c.status === "ACTIVE" ? "HIDDEN" : "ACTIVE" }),
    });
    load();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Categorias</h1>
        <p className="text-sm text-ink-mute">{items.length} categoria(s)</p>
      </div>

      <form onSubmit={save} className="rounded-xl border border-ink/10 bg-white p-5">
        <p className="font-semibold text-ink">{editing ? "Editar categoria" : "Nova categoria"}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Input label="Nome" required value={name} onChange={setName} />
          <div className="sm:col-span-2">
            <Input label="Descrição" value={description} onChange={setDescription} />
          </div>
        </div>
        {msg && <p className="mt-2 text-xs text-ink-soft">{msg}</p>}
        <div className="mt-3 flex gap-2">
          <Button type="submit" size="sm">{editing ? "Salvar" : "Criar"}</Button>
          {editing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(null);
                setName("");
                setDescription("");
              }}
            >
              Cancelar
            </Button>
          )}
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-divine-50">
            <tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-mute">
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Produtos</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-ink-mute">Carregando...</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-ink-mute">
                  Nenhuma categoria.
                </td>
              </tr>
            )}
            {items.map((c) => (
              <tr key={c.id} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{c.name}</p>
                  <p className="text-xs text-ink-mute">/{c.slug}</p>
                </td>
                <td className="px-4 py-3 text-ink-soft">{c._count?.products ?? 0}</td>
                <td className="px-4 py-3">
                  <Badge status={c.status === "ACTIVE" ? "ACTIVE" : "HIDDEN"}>
                    {c.status === "ACTIVE" ? "Ativa" : "Oculta"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-3 text-xs">
                    <button
                      onClick={() => {
                        setEditing(c);
                        setName(c.name);
                        setDescription(c.description || "");
                      }}
                      className="font-semibold text-divine-700 hover:underline"
                    >
                      Editar
                    </button>
                    <button onClick={() => toggleStatus(c)} className="text-ink-mute hover:underline">
                      {c.status === "ACTIVE" ? "Ocultar" : "Ativar"}
                    </button>
                    <button onClick={() => remove(c)} className="text-red-600 hover:underline">
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
