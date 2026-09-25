"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

type Category = { id: string; name: string };

type Variation = { size: string; color: string; stock: string; sku: string };

type Form = {
  name: string;
  description: string;
  price: string;
  comparePrice: string;
  sku: string;
  stock: string;
  categoryId: string;
  isActive: boolean;
  featured: boolean;
  sizes: string;
  colors: string;
  images: string[];
};

export default function EditarProdutoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([fetch("/api/categorias"), fetch(`/api/admin/produtos/${id}`)]).then(
      async ([catsRes, prodRes]) => {
        const cats = await catsRes.json();
        setCategories(cats.items || []);
        if (!prodRes.ok) {
          setError("Produto não encontrado");
          return;
        }
        const data = await prodRes.json();
        const p = data.product;
        setForm({
          name: p.name,
          description: p.description,
          price: String(Number(p.price)),
          comparePrice: p.comparePrice ? String(Number(p.comparePrice)) : "",
          sku: p.sku || "",
          stock: String(p.stock),
          categoryId: p.categoryId,
          isActive: p.isActive,
          featured: p.featured,
          sizes: (p.sizes || []).join(", "),
          colors: (p.colors || []).join(", "),
          images: p.images || [],
        });
        setVariations(
          (p.variations || []).map(
            (v: { size: string; color?: string | null; stock: number; sku?: string | null }) => ({
              size: v.size,
              color: v.color || "",
              stock: String(v.stock),
              sku: v.sku || "",
            })
          )
        );
      }
    );
  }, [id]);

  const hasVariations = variations.length > 0;
  const variationStock = variations.reduce((s, v) => s + (Number(v.stock) || 0), 0);

  function setVariation(i: number, key: keyof Variation, value: string) {
    setVariations((vs) => vs.map((v, j) => (j === i ? { ...v, [key]: value } : v)));
  }

  const upload = useCallback(async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no upload");
      setForm((f) => (f ? { ...f, images: [...f.images, data.url] } : f));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/produtos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          price: Number(form.price),
          comparePrice: form.comparePrice ? Number(form.comparePrice) : null,
          sku: form.sku || null,
          stock: hasVariations ? variationStock : Number(form.stock),
          categoryId: form.categoryId,
          isActive: form.isActive,
          featured: form.featured,
          images: form.images,
          sizes: form.sizes.split(",").map((s) => s.trim()).filter(Boolean),
          colors: form.colors.split(",").map((s) => s.trim()).filter(Boolean),
          variations: variations.map((v) => ({
            size: v.size.trim(),
            color: v.color.trim() || null,
            stock: Number(v.stock) || 0,
            sku: v.sku.trim() || null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao salvar");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  }

  if (!form && !error) return <p className="text-ink-mute">Carregando produto...</p>;
  if (error && !form)
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {error}
      </div>
    );

  if (!form) return null;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Editar produto</h1>
          <p className="text-sm text-ink-mute">Atualize as informações da peça.</p>
        </div>
        <Button href="/admin/produtos" variant="outline" size="sm">
          ← Voltar
        </Button>
      </div>

      <form onSubmit={submit} className="space-y-6 rounded-xl border border-ink/10 bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Nome" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          </div>
          <div className="sm:col-span-2">
            <Input label="Descrição" textarea required value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
          </div>
          <Input label="Preço (R$)" type="number" step="0.01" min="0.01" required value={form.price} onChange={(v) => setForm({ ...form, price: v })} />
          <Input label="Preço de comparação (R$)" type="number" step="0.01" value={form.comparePrice} onChange={(v) => setForm({ ...form, comparePrice: v })} />
          <Input label="SKU" value={form.sku} onChange={(v) => setForm({ ...form, sku: v })} />
          <Input
            label={hasVariations ? "Estoque (soma das variações)" : "Estoque"}
            type="number"
            min="0"
            required={!hasVariations}
            disabled={hasVariations}
            value={hasVariations ? String(variationStock) : form.stock}
            onChange={(v) => setForm({ ...form, stock: v })}
          />
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
          <Input label="Tamanhos (vírgula)" value={form.sizes} onChange={(v) => setForm({ ...form, sizes: v })} />
          <Input label="Cores (vírgula)" value={form.colors} onChange={(v) => setForm({ ...form, colors: v })} />
        </div>

        <div className="border-t border-ink/10 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-mute">
              Variações e estoque por variação
            </p>
            <button
              type="button"
              className="text-xs font-semibold text-divine-700 hover:underline"
              onClick={() =>
                setVariations((vs) => [...vs, { size: "", color: "", stock: "0", sku: "" }])
              }
            >
              + Adicionar variação
            </button>
          </div>
          {variations.length === 0 ? (
            <p className="mt-2 text-xs text-ink-mute">
              Sem variações — o estoque é gerenciado no campo acima.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {variations.map((v, i) => (
                <div key={i} className="grid grid-cols-12 items-end gap-2">
                  <div className="col-span-3">
                    <Input label="Tamanho" required value={v.size} onChange={(val) => setVariation(i, "size", val)} placeholder="P" />
                  </div>
                  <div className="col-span-3">
                    <Input label="Cor" value={v.color} onChange={(val) => setVariation(i, "color", val)} placeholder="Verde" />
                  </div>
                  <div className="col-span-2">
                    <Input label="Estoque" type="number" min="0" value={v.stock} onChange={(val) => setVariation(i, "stock", val)} />
                  </div>
                  <div className="col-span-3">
                    <Input label="SKU var." value={v.sku} onChange={(val) => setVariation(i, "sku", val)} />
                  </div>
                  <div className="col-span-1 pb-2">
                    <button
                      type="button"
                      onClick={() => setVariations((vs) => vs.filter((_, j) => j !== i))}
                      className="rounded-lg border border-ink/15 px-2 py-1.5 text-xs text-red-600"
                      title="Remover"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              <p className="text-xs text-ink-mute">Estoque total: {variationStock} un.</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-6 border-t border-ink/10 pt-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Produto ativo
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.featured}
              onChange={(e) => setForm({ ...form, featured: e.target.checked })}
            />
            Destaque
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
                  onClick={() => setForm({ ...form, images: form.images.filter((_, j) => j !== i) })}
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
        </div>

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <div className="flex gap-3 border-t border-ink/10 pt-4">
          <Button type="submit" disabled={loading || uploading}>
            {saved ? "✓ Salvo!" : loading ? "Salvando..." : "Salvar alterações"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/admin/produtos")}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
