"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  ProductContentFields,
  emptyProductContent,
} from "@/components/admin/ProductContentFields";
import { ProductImagesEditor } from "@/components/admin/ProductImagesEditor";

type Category = { id: string; name: string };

export default function NovoProdutoPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [sizeTables, setSizeTables] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
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
    imageColors: [] as string[],
    imageAlts: [] as string[],
    ...emptyProductContent,
    tabelaMedidasId: "",
  });

  useEffect(() => {
    fetch("/api/categorias")
      .then((r) => r.json())
      .then((d) => {
        setCategories(d.items || []);
        if (d.items?.[0]) setForm((f) => ({ ...f, categoryId: d.items[0].id }));
      });
    fetch("/api/admin/tabelas-medidas")
      .then((r) => r.json())
      .then((d) => setSizeTables(d.items || []))
      .catch(() => {});
  }, []);

  const uploadUrl = useCallback(async (file: File): Promise<string | null> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha no upload");
    return data.url as string;
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
          composicao: form.composicao || null,
          instrucoesLavagem: form.instrucoesLavagem || null,
          comprimento: form.comprimento || null,
          modeloAltura: form.modeloAltura || null,
          modeloVeste: form.modeloVeste || null,
          caimento: form.caimento || null,
          ocasiao: form.ocasiao || null,
          metaTitle: form.metaTitle || null,
          metaDescription: form.metaDescription || null,
          tabelaMedidasId: form.tabelaMedidasId || null,
          imageColors: form.imageColors,
          imageAlts: form.imageAlts,
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
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">Guia de medidas</span>
            <select
              value={form.tabelaMedidasId}
              onChange={(e) => setForm({ ...form, tabelaMedidasId: e.target.value })}
              className="w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-ink/50"
            >
              <option value="">Nenhum (oculta o link na loja)</option>
              {sizeTables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
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

        {form && (
          <ProductContentFields
            value={form}
            onChange={(c) => setForm({ ...form, ...c })}
          />
        )}

        <div className="border-t border-ink/10 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-mute">Imagens</p>
          <div className="mt-3">
            <ProductImagesEditor
              images={form.images}
              colors={form.imageColors}
              alts={form.imageAlts}
              colorOptions={form.colors.split(",").map((s) => s.trim()).filter(Boolean)}
              onChange={(images, colors, alts) =>
                setForm({ ...form, images, imageColors: colors, imageAlts: alts })
              }
              onUpload={uploadUrl}
            />
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}

        <div className="flex gap-3 border-t border-ink/10 pt-4">
          <Button type="submit" disabled={loading}>
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
