"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

type Category = { id: string; name: string };

export default function NovoProdutoPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    comparePrice: "",
    sku: "",
    stock: "0",
    categoryId: "",
    isActive: true,
    featured: false,
    sizes: "",
    colors: "",
    images: [] as string[],
  });

  useEffect(() => {
    fetch("/api/categorias")
      .then((r) => r.json())
      .then((d) => {
        setCategories(d.items || []);
        if (d.items?.[0]) setForm((f) => ({ ...f, categoryId: d.items[0].id }));
      });
  }, []);

  const upload = useCallback(async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no upload");
      setForm((f) => ({ ...f, images: [...f.images, data.url] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/produtos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          price: Number(form.price),
          comparePrice: form.comparePrice ? Number(form.comparePrice) : null,
          sku: form.sku || null,
          stock: Number(form.stock),
          categoryId: form.categoryId,
          isActive: form.isActive,
          featured: form.featured,
          images: form.images,
          sizes: form.sizes.split(",").map((s) => s.trim()).filter(Boolean),
          colors: form.colors.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao salvar");
        return;
      }
      router.push("/admin/produtos");
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Novo produto</h1>
        <p className="text-sm text-ink-mute">Preencha os dados e publique na loja.</p>
      </div>

      <form onSubmit={submit} className="space-y-6 rounded-xl border border-ink/10 bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Nome" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          </div>
          <div className="sm:col-span-2">
            <Input
              label="Descrição"
              textarea
              required
              value={form.description}
              onChange={(v) => setForm({ ...form, description: v })}
            />
          </div>
          <Input label="Preço (R$)" type="number" step="0.01" min="0.01" required value={form.price} onChange={(v) => setForm({ ...form, price: v })} />
          <Input label="Preço de comparación (R$)" type="number" step="0.01" value={form.comparePrice} onChange={(v) => setForm({ ...form, comparePrice: v })} />
          <Input label="SKU" value={form.sku} onChange={(v) => setForm({ ...form, sku: v })} />
          <Input label="Estoque" type="number" min="0" required value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} />
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">Categoria *</span>
            <select
              required
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              className="w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-ink/50"
            >
              <option value="">Selecione...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <Input label="Tamanhos (vírgula)" placeholder="P, M, G, GG" value={form.sizes} onChange={(v) => setForm({ ...form, sizes: v })} />
          <Input label="Cores (vírgula)" placeholder="Preto, Branco, Dourado" value={form.colors} onChange={(v) => setForm({ ...form, colors: v })} />
        </div>

        <div className="flex flex-wrap gap-6 border-t border-ink/10 pt-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Produto ativo (visível na loja)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.featured}
              onChange={(e) => setForm({ ...form, featured: e.target.checked })}
            />
            Destaque na home
          </label>
        </div>

        <div className="border-t border-ink/10 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-mute">Imagens</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {form.images.map((img, i) => (
              <div key={i} className="relative h-24 w-24 overflow-hidden rounded-lg border border-ink/10">
                <img src={img} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() =>
                    setForm({ ...form, images: form.images.filter((_, j) => j !== i) })
                  }
                  className="absolute right-1 top-1 rounded-full bg-red-600 px-1.5 text-xs text-white"
                >
                  ×
                </button>
              </div>
            ))}
            <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-ink/20 text-xs text-ink-mute hover:border-divine-400">
              {uploading ? "..." : "+ Enviar"}
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
          </div>
          <p className="mt-2 text-xs text-ink-mute">JPG, PNG, WEBP ou GIF — máx 5MB.</p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}

        <div className="flex gap-3 border-t border-ink/10 pt-4">
          <Button type="submit" disabled={loading || uploading}>
            {loading ? "Salvando..." : "Criar produto"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
