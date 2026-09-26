"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

const TYPES = [
  { id: "vendas", label: "Vendas (pedidos × itens)" },
  { id: "categoria", label: "Vendas por categoria" },
  { id: "cupons", label: "Desempenho de cupons" },
  { id: "carrinho", label: "Abandono de carrinho" },
] as const;

type TypeId = (typeof TYPES)[number]["id"];

function today(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default function AdminRelatoriosPage() {
  const [tipo, setTipo] = useState<TypeId>("vendas");
  const [de, setDe] = useState(today(-30));
  const [ate, setAte] = useState(today());
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const baseUrl = `/api/admin/relatorios?tipo=${tipo}&de=${de}&ate=${ate}`;

  async function preview() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(baseUrl);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao gerar relatório");
        setRows([]);
        return;
      }
      setRows(data.rows || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    preview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Relatórios</h1>
        <p className="text-sm text-ink-mute">
          Exportação em CSV (separador <code>;</code>) — compatível com planilhas e BI.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ink/10 bg-white p-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">Tipo</span>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TypeId)}
            className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none"
          >
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">De</span>
          <input
            type="date"
            value={de}
            onChange={(e) => setDe(e.target.value)}
            className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">Até</span>
          <input
            type="date"
            value={ate}
            onChange={(e) => setAte(e.target.value)}
            className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none"
          />
        </label>
        <Button size="sm" variant="outline" onClick={preview} disabled={loading}>
          {loading ? "Gerando..." : "Prévia"}
        </Button>
        <a href={`${baseUrl}&formato=csv`}>
          <Button size="sm">Baixar CSV</Button>
        </a>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-primary-50">
              <tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-mute">
                {headers.map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-ink-mute">
                    {loading ? "Carregando..." : "Sem dados no período selecionado."}
                  </td>
                </tr>
              )}
              {rows.slice(0, 100).map((r, i) => (
                <tr key={i} className="border-b border-ink/5 last:border-0">
                  {headers.map((h) => (
                    <td key={h} className="whitespace-nowrap px-4 py-2.5 text-ink-soft">
                      {String(r[h] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 100 && (
          <p className="border-t border-ink/10 px-4 py-2 text-xs text-ink-mute">
            Mostrando 100 de {rows.length} linhas — baixe o CSV para ver tudo.
          </p>
        )}
      </div>
    </div>
  );
}
