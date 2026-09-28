"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

type Col = { key: string; label: string };
type Row = { size: string; values: Record<string, string> };
type Table = {
  id: string;
  name: string;
  unit: string;
  columns: Col[];
  rows: Row[];
  note?: string | null;
};

const empty = { name: "", unit: "cm", note: "", columns: [] as Col[], rows: [] as Row[] };

export default function AdminTabelasPage() {
  const [items, setItems] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Table | null>(null);
  const [form, setForm] = useState(empty);
  const [msg, setMsg] = useState("");

  // editor de colunas
  const [colKey, setColKey] = useState("");
  const [colLabel, setColLabel] = useState("");
  // editor de linhas
  const [rowSize, setRowSize] = useState("");
  const [rowVals, setRowVals] = useState<Record<string, string>>({});

  async function load() {
    const res = await fetch("/api/admin/tabelas-medidas");
    if (res.ok) setItems((await res.json()).items || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function startNew() {
    setEditing(null);
    setForm(empty);
    setMsg("");
  }

  function startEdit(t: Table) {
    setEditing(t);
    setForm({
      name: t.name,
      unit: t.unit,
      note: t.note || "",
      columns: t.columns,
      rows: t.rows,
    });
    setMsg("");
  }

  function addColumn() {
    const key = colKey.trim().toLowerCase().replace(/\s+/g, "_");
    const label = colLabel.trim() || key;
    if (!key || form.columns.some((c) => c.key === key)) return;
    setForm((f) => ({ ...f, columns: [...f.columns, { key, label }] }));
    setColKey("");
    setColLabel("");
  }

  function addRow() {
    const size = rowSize.trim();
    if (!size || form.rows.some((r) => r.size.toLowerCase() === size.toLowerCase())) return;
    const values: Record<string, string> = {};
    for (const c of form.columns) values[c.key] = (rowVals[c.key] || "").trim();
    setForm((f) => ({ ...f, rows: [...f.rows, { size, values }] }));
    setRowSize("");
    setRowVals({});
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (form.columns.length === 0) {
      setMsg("Adicione ao menos 1 coluna (ex.: busto, cintura).");
      return;
    }
    const res = await fetch(
      editing ? `/api/admin/tabelas-medidas/${editing.id}` : "/api/admin/tabelas-medidas",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, note: form.note || null }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "Erro ao salvar");
      return;
    }
    setMsg(editing ? "Tabela atualizada." : "Tabela criada.");
    startNew();
    load();
  }

  async function remove(t: Table) {
    if (!confirm(`Excluir a tabela "${t.name}"?`)) return;
    const res = await fetch(`/api/admin/tabelas-medidas/${t.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Erro ao excluir");
      return;
    }
    load();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Guias de medidas</h1>
        <p className="text-sm text-ink-mute">
          Tabelas reutilizáveis vinculadas a produtos ou categorias (fallback).
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-primary-50">
            <tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-mute">
              <th className="px-4 py-3">Tabela</th>
              <th className="px-4 py-3">Colunas</th>
              <th className="px-4 py-3">Tamanhos</th>
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
                <td colSpan={4} className="px-4 py-8 text-center text-ink-mute">Nenhuma tabela.</td>
              </tr>
            )}
            {items.map((t) => (
              <tr key={t.id} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{t.name}</p>
                  <p className="text-xs text-ink-mute">unidade: {t.unit}</p>
                </td>
                <td className="px-4 py-3 text-ink-soft">{t.columns.length}</td>
                <td className="px-4 py-3 text-ink-soft">{t.rows.length}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-3 text-xs">
                    <button onClick={() => startEdit(t)} className="font-semibold text-primary-700 hover:underline">
                      Editar
                    </button>
                    <button onClick={() => remove(t)} className="text-red-600 hover:underline">
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={save} className="space-y-4 rounded-xl border border-ink/10 bg-white p-5">
        <p className="font-semibold text-ink">{editing ? "Editar tabela" : "Nova tabela"}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Nome" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Feminino adulto" />
          <Input label="Unidade" required value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} placeholder="cm" />
          <div className="sm:col-span-1">
            <Input label="Nota (opcional)" value={form.note} onChange={(v) => setForm({ ...form, note: v })} placeholder="Medidas do corpo..." />
          </div>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-mute">Colunas</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {form.columns.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-800">
                {c.label}
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, columns: f.columns.filter((x) => x.key !== c.key) }))}
                  className="text-ink-mute hover:text-red-600"
                  aria-label={`Remover coluna ${c.label}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex max-w-md gap-2">
            <Input label="Chave" value={colKey} onChange={setColKey} placeholder="busto" />
            <Input label="Rótulo" value={colLabel} onChange={setColLabel} placeholder="Busto" />
            <div className="flex items-end pb-0.5">
              <Button type="button" size="sm" variant="outline" onClick={addColumn}>+</Button>
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-mute">Linhas por tamanho</p>
          {form.rows.length > 0 && (
            <div className="mt-2 overflow-x-auto rounded-lg border border-ink/10">
              <table className="w-full text-sm">
                <thead className="bg-primary-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs uppercase text-ink-mute">Tam.</th>
                    {form.columns.map((c) => (
                      <th key={c.key} className="px-3 py-2 text-left text-xs uppercase text-ink-mute">{c.label}</th>
                    ))}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {form.rows.map((r) => (
                    <tr key={r.size} className="border-t border-ink/5">
                      <td className="px-3 py-2 font-semibold">{r.size}</td>
                      {form.columns.map((c) => (
                        <td key={c.key} className="px-3 py-2 text-ink-soft">
                          {r.values[c.key] || "—"}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, rows: f.rows.filter((x) => x.size !== r.size) }))}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 flex max-w-lg flex-wrap items-end gap-2">
            <div className="w-24">
              <Input label="Tamanho" value={rowSize} onChange={setRowSize} placeholder="M" />
            </div>
            {form.columns.map((c) => (
              <div key={c.key} className="w-24">
                <Input
                  label={c.label}
                  value={rowVals[c.key] || ""}
                  onChange={(v) => setRowVals((s) => ({ ...s, [c.key]: v }))}
                  placeholder="—"
                />
              </div>
            ))}
            <div className="pb-0.5">
              <Button type="button" size="sm" variant="outline" onClick={addRow}>+ linha</Button>
            </div>
          </div>
        </div>

        {msg && <p className="text-xs text-ink-soft">{msg}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm">{editing ? "Salvar" : "Criar"}</Button>
          {editing && (
            <Button type="button" variant="outline" size="sm" onClick={startNew}>Cancelar</Button>
          )}
          {!editing && (form.name || form.columns.length > 0) && (
            <Button type="button" variant="outline" size="sm" onClick={startNew}>Limpar</Button>
          )}
        </div>
      </form>
    </div>
  );
}
