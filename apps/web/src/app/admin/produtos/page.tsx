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
  _count?: { orderItems: number };
  custo_peca_centavos: number;
  custo_embalagem_centavos: number;
  custos_extras_centavos: number;
  preco_sugerido_centavos: number | null;
  precificacao_calculada_em: string | null;
};

type Diff = {
  id: string;
  name: string;
  slug: string;
  custoTotal: number;
  precoAtual: number;
  precoSugerido: number;
  margemAtual: number;
  margemSugerida: number;
  abaixoMinima: boolean;
};

const brl = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

export default function AdminProdutosPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "sem-custo" | "abaixo-minima">("todos");
  const [ordenarMargem, setOrdenarMargem] = useState(false);
  const [margemMinima, setMargemMinima] = useState<number | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [diffs, setDiffs] = useState<Diff[] | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [recalcLoading, setRecalcLoading] = useState(false);
  const [recalcMsg, setRecalcMsg] = useState("");

  useEffect(() => {
    fetch("/api/admin/produtos")
      .then((r) => r.json())
      .then((d) => setItems(d.items || []))
      .finally(() => setLoading(false));
    fetch("/api/admin/precificacao")
      .then((r) => r.json())
      .then((d) => setMargemMinima(d.config?.margem_minima_percentual ?? null))
      .catch(() => {});
  }, []);

  async function remove(p: Product) {
    const temPedidos = (p._count?.orderItems ?? 0) > 0;
    const confirma = temPedidos
      ? `"${p.name}" já foi vendido e será DESATIVADO: some da loja, mas o histórico de pedidos é preservado. Continuar?`
      : `Excluir "${p.name}" definitivamente?`;
    if (!confirm(confirma)) return;
    const res = await fetch(`/api/admin/produtos/${p.id}`, { method: "DELETE" });
    if (res.ok) setItems((prev) => prev.filter((x) => x.id !== p.id));
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
          (data.errors?.length ? ` — ${data.errors.length} erro(s)` : "") +
          (data.semCusto?.length ? ` — ${data.semCusto.length} sem custo (${data.semCusto.slice(0, 3).join(", ")}${data.semCusto.length > 3 ? ", …" : ""})` : "")
      );
      // Fecha o painel só quando não há nada a ler; com erros ou semCusto,
      // o relatório precisa continuar visível.
      if (data.created > 0 && !data.errors?.length && !data.semCusto?.length) {
        setCsvText("");
        setShowImport(false);
      }
    } finally {
      setImporting(false);
    }
  }

  const custoTotalDe = (p: Product) =>
    (p.custo_peca_centavos || 0) + (p.custo_embalagem_centavos || 0) + (p.custos_extras_centavos || 0);
  const precoCentavosDe = (p: Product) => Math.round(Number(p.price) * 100);
  const margemDe = (p: Product) => {
    const custo = custoTotalDe(p);
    const preco = precoCentavosDe(p);
    if (custo <= 0 || preco <= 0) return null;
    return Math.round(((preco - custo) / preco) * 10000) / 100;
  };
  const temCusto = (p: Product) => p.precificacao_calculada_em !== null;

  const filtered = items
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q.toLowerCase()) ||
        p.category.name.toLowerCase().includes(q.toLowerCase())
    )
    .filter((p) => {
      if (filtro === "sem-custo") return !temCusto(p);
      if (filtro === "abaixo-minima") {
        if (margemMinima === null) return false;
        const m = margemDe(p);
        return m !== null && m < margemMinima;
      }
      return true;
    })
    .sort((a, b) => {
      if (!ordenarMargem) return 0;
      const ma = margemDe(a);
      const mb = margemDe(b);
      if (ma === null && mb === null) return 0;
      if (ma === null) return 1;
      if (mb === null) return -1;
      return ma - mb;
    });

  async function gerarDiff() {
    setRecalcLoading(true);
    setRecalcMsg("");
    setDiffs(null);
    try {
      const res = await fetch("/api/admin/produtos/recalcular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRecalcMsg(data.error || "Erro ao recalcular");
        return;
      }
      setDiffs(data.diffs || []);
      setSelecionados(new Set((data.diffs || []).map((d: Diff) => d.id)));
    } finally {
      setRecalcLoading(false);
    }
  }

  async function aplicarSelecionados() {
    if (selecionados.size === 0) return;
    if (!confirm(`Aplicar o preço sugerido a ${selecionados.size} produto(s)?`)) return;
    setRecalcLoading(true);
    try {
      const res = await fetch("/api/admin/produtos/recalcular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aplicar: [...selecionados] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRecalcMsg(data.error || "Erro ao aplicar");
        return;
      }
      setRecalcMsg(`${data.aplicados} preço(s) atualizado(s).`);
      setDiffs(null);
      const list = await fetch("/api/admin/produtos");
      if (list.ok) setItems((await list.json()).items || []);
    } finally {
      setRecalcLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Produtos</h1>
          <p className="text-sm text-ink-mute">{items.length} cadastrado(s)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar..."
            className="rounded-full border border-ink/15 bg-white px-4 py-2 text-sm outline-none"
          />
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as typeof filtro)}
            className="rounded-full border border-ink/15 bg-white px-3 py-2 text-sm outline-none"
            title="Filtro de precificação"
          >
            <option value="todos">Todos</option>
            <option value="sem-custo">Sem custo informado</option>
            <option value="abaixo-minima">Abaixo da margem mínima</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            <input
              type="checkbox"
              checked={ordenarMargem}
              onChange={(e) => setOrdenarMargem(e.target.checked)}
            />
            ordenar por margem
          </label>
          <Button variant="outline" size="sm" onClick={gerarDiff} disabled={recalcLoading}>
            {recalcLoading ? "Calculando..." : "Recalcular preços"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowImport((v) => !v)}>
            Importar CSV
          </Button>
          <Button href="/admin/produtos/novo">+ Novo produto</Button>
        </div>
      </div>
      {recalcMsg && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{recalcMsg}</p>}

      {diffs !== null && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/50 p-5">
          <p className="font-semibold text-ink">
            Revisão — nada muda até você confirmar
          </p>
          <p className="text-xs text-ink-mute">
            Marque os produtos para aplicar o preço sugerido (recalculado na hora, com os custos atuais).
          </p>
          {diffs.length === 0 ? (
            <p className="mt-2 text-sm text-ink-mute">Nenhum produto com custo informado.</p>
          ) : (
            <>
              <div className="mt-3 max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-ink-mute">
                      <th className="px-2 py-2"></th>
                      <th className="px-2 py-2">Produto</th>
                      <th className="px-2 py-2">Atual</th>
                      <th className="px-2 py-2">Sugerido</th>
                      <th className="px-2 py-2">Margem atual → sugerida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((d) => (
                      <tr key={d.id} className="border-t border-ink/10">
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={selecionados.has(d.id)}
                            onChange={(e) =>
                              setSelecionados((s) => {
                                const c = new Set(s);
                                if (e.target.checked) c.add(d.id);
                                else c.delete(d.id);
                                return c;
                              })
                            }
                          />
                        </td>
                        <td className="px-2 py-2">{d.name}</td>
                        <td className="px-2 py-2">{brl(d.precoAtual)}</td>
                        <td className="px-2 py-2 font-semibold">{brl(d.precoSugerido)}</td>
                        <td className="px-2 py-2">
                          {d.margemAtual}% → {d.margemSugerida}%
                          {d.abaixoMinima && <span className="ml-1 text-amber-700">⚠</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={aplicarSelecionados} disabled={selecionados.size === 0 || recalcLoading}>
                  Aplicar selecionados ({selecionados.size})
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDiffs(null)}>
                  Cancelar
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {showImport && (
        <div className="rounded-xl border border-ink/10 bg-white p-5">
          <p className="font-semibold text-ink">Importação em massa (CSV)</p>
          <p className="mt-1 text-xs text-ink-mute">
            Colunas: <code>nome,descricao,preco,preco_de,estoque,categoria,sku,tamanhos,cores</code> —
            tamanhos/cores separados por <code>|</code>. Opcionais de custo:{" "}
            <code>lote_id,lote,custo_peca,markup,custos_extras</code> (sem elas, o
            produto entra na lista &quot;sem custo&quot; do relatório).
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
                <th className="px-4 py-3">Custo</th>
                <th className="px-4 py-3">Lucro</th>
                <th className="px-4 py-3">Margem</th>
                <th className="px-4 py-3">Estoque</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-ink-mute">
                    Carregando...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-ink-mute">
                    Nenhum produto encontrado.
                  </td>
                </tr>
              )}
              {filtered.map((p) => {
                const custo = custoTotalDe(p);
                const preco = precoCentavosDe(p);
                const comCusto = temCusto(p);
                const lucro = comCusto ? preco - custo : null;
                const margem = margemDe(p);
                return (
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
                  <td className="px-4 py-3 text-ink-soft">{comCusto ? brl(custo) : "—"}</td>
                  <td className={`px-4 py-3 ${lucro !== null && lucro < 0 ? "font-semibold text-red-600" : ""}`}>
                    {lucro !== null ? brl(lucro) : "—"}
                  </td>
                  <td className={`px-4 py-3 ${margem !== null && margemMinima !== null && margem < margemMinima ? "font-semibold text-amber-700" : ""}`}>
                    {margem !== null ? `${margem}%` : "—"}
                  </td>
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
                      <button onClick={() => remove(p)} className="text-red-600 hover:underline">
                        {(p._count?.orderItems ?? 0) > 0 ? "Desativar" : "Excluir"}
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
