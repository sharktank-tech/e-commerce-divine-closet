"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBRL } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type Product = {
  id: string;
  name: string;
  slug: string;
  price: string | number;
  stock: number;
  isActive: boolean;
  featured: boolean;
  images: string[];
  category: { name: string };
};

export default function AdminProdutosPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  useEffect(() => {
    fetch("/api/admin/produtos")
      .then((r) => r.json())
      .then((d) => setItems(d.items || []))
      .finally(() => setLoading(false));
  }, []);

  async function remove(id: string) {
    if (!confirm("Excluir este produto?")) return;
    const res = await fetch(`/api/admin/produtos/${id}`, { method: "DELETE" });
    if (res.ok) setItems((prev) => prev.filter((p) => p.id !== id));
    else alert("Erro ao excluir");
  }

  async function importCsv() {
    if (!csvText.trim()) return;
    setImporting(true);
    setImportMsg("");
    try {
      const res = await fetch("/api/admin/produtos/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportMsg(data.error || "Erro na importação");
        return;
      }
      const list = await fetch("/api/admin/produtos");
      if (list.ok) setItems((await list.json()).items || []);
      setImportMsg(
        `Importados: ${data.created} produto(s)` +
          (data.errors?.length ? ` — ${data.errors.length} erro(s)` : "")
      );
      if (data.created > 0) {
        setCsvText("");
        setShowImport(false);
      }
    } finally {
      setImporting(false);
    }
  }

  const filtered = items.filter(
    (p) =>
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.category.name.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Produtos</h1>
          <p className="text-sm text-ink-mute">{items.length} cadastrado(s)</p>
        </div>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar..."
            className="rounded-full border border-ink/15 bg-white px-4 py-2 text-sm outline-none"
          />
          <Button variant="outline" size="sm" onClick={() => setShowImport((v) => !v)}>
            Importar CSV
          </Button>
          <Button href="/admin/produtos/novo">+ Novo produto</Button>
        </div>
      </div>

      {showImport && (
        <div className="rounded-xl border border-ink/10 bg-white p-5">
          <p className="font-semibold text-ink">Importação em massa (CSV)</p>
          <p className="mt-1 text-xs text-ink-mute">
            Colunas: <code>nome,descricao,preco,estoque,categoria,sku,tamanhos,cores</code> —
            tamanhos/cores separados por <code>|</code>.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={6}
              placeholder={'nome,descricao,preco,estoque,categoria,sku,tamanhos,cores\nVestido Floral,Descrição,189.90,10,Vestidos,VST-001,P|PP,Verde|Preto'}
              className="w-full rounded-lg border border-ink/15 px-3 py-2 font-mono text-xs outline-none focus:border-ink/40"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="cursor-pointer rounded-lg border border-ink/15 px-3 py-2 text-xs font-semibold text-ink-soft hover:border-ink/30">
                Selecionar arquivo .csv
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) f.text().then(setCsvText);
                  }}
                />
              </label>
              <Button size="sm" onClick={importCsv} disabled={importing || !csvText.trim()}>
                {importing ? "Importando..." : "Importar"}
              </Button>
              {importMsg && <span className="text-xs text-ink-soft">{importMsg}</span>}
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-primary-50">
              <tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-mute">
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3">Preço</th>
                <th className="px-4 py-3">Estoque</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-ink-mute">
                    Carregando...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-ink-mute">
                    Nenhum produto encontrado.
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-ink/5 last:border-0 hover:bg-primary-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-primary-100">
                        {p.images[0] ? (
                          <img src={p.images[0]} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div>
                        <p className="font-medium text-ink">{p.name}</p>
                        <p className="text-xs text-ink-mute">/{p.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{p.category.name}</td>
                  <td className="px-4 py-3 font-medium">{formatBRL(p.price)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        p.stock === 0
                          ? "font-semibold text-red-600"
                          : p.stock <= 5
                            ? "font-semibold text-amber-700"
                            : "text-ink-soft"
                      }
                    >
                      {p.stock}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <Badge status={p.isActive ? "ACTIVE" : "HIDDEN"}>
                        {p.isActive ? "Ativo" : "Oculto"}
                      </Badge>
                      {p.featured && <Badge status="PAID">Destaque</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3 text-xs">
                      <Link
                        href={`/produtos/${p.slug}`}
                        target="_blank"
                        className="text-ink-mute hover:text-ink"
                      >
                        Ver
                      </Link>
                      <Link
                        href={`/admin/produtos/${p.id}`}
                        className="font-semibold text-primary-700 hover:underline"
                      >
                        Editar
                      </Link>
                      <button onClick={() => remove(p.id)} className="text-red-600 hover:underline">
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
    </div>
  );
}
