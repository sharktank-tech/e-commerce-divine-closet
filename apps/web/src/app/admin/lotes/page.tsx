"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  arredondarCusto,
  custoUnitarioBruto,
  formatarReais,
} from "@/lib/precificacao";

type Lote = {
  id: string;
  nome: string;
  data_compra: string;
  valor_mercadoria_centavos: number;
  valor_frete_centavos: number;
  quantidade_pecas: number;
  categoria_id: string | null;
  observacoes: string | null;
  produtosVinculados: number;
};

type Category = { id: string; name: string };

const reaisParaCentavos = (v: string) =>
  Math.max(0, Math.round(Number(String(v).replace(",", ".")) * 100) || 0);

export default function LotesPage() {
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [categorias, setCategorias] = useState<Category[]>([]);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({
    nome: "",
    data: new Date().toISOString().slice(0, 10),
    mercadoria: "",
    frete: "",
    qtd: "",
    categoria: "",
    obs: "",
  });

  async function load() {
    const [lotesRes, catsRes] = await Promise.all([
      fetch("/api/admin/lotes"),
      fetch("/api/categorias"),
    ]);
    if (lotesRes.ok) setLotes((await lotesRes.json()).items || []);
    if (catsRes.ok) setCategorias((await catsRes.json()).items || []);
  }

  useEffect(() => {
    load();
  }, []);

  // Cálculo em tempo real antes de salvar.
  const previa = useMemo(() => {
    try {
      const merc = reaisParaCentavos(form.mercadoria);
      const frete = reaisParaCentavos(form.frete);
      const qtd = Number(form.qtd) || 0;
      if (qtd <= 0) return null;
      const bruto = custoUnitarioBruto(merc, frete, qtd, "lote");
      const arred = Math.round(arredondarCusto(bruto, "inteiro_para_cima"));
      return { total: merc + frete, bruto, arred };
    } catch {
      return null;
    }
  }, [form.mercadoria, form.frete, form.qtd]);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/admin/lotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: form.nome,
        data_compra: form.data,
        valor_mercadoria_centavos: reaisParaCentavos(form.mercadoria),
        valor_frete_centavos: reaisParaCentavos(form.frete),
        quantidade_pecas: Number(form.qtd),
        categoria_id: form.categoria || null,
        observacoes: form.obs || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data.error || "Erro ao criar lote");
      return;
    }
    setForm({ nome: "", data: new Date().toISOString().slice(0, 10), mercadoria: "", frete: "", qtd: "", categoria: "", obs: "" });
    load();
  }

  async function excluir(l: Lote) {
    if (!confirm(`Excluir o lote "${l.nome}"?`)) return;
    const res = await fetch(`/api/admin/lotes/${l.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) alert(data.error || "Erro ao excluir");
    else load();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Lotes de compra</h1>
        <p className="text-sm text-ink-mute">
          Cada lote guarda mercadoria + frete para ratear o custo por peça.
        </p>
      </div>
      {msg && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</p>}

      <form onSubmit={criar} className="space-y-4 rounded-xl border border-ink/10 bg-white p-6">
        <p className="font-semibold text-ink">Novo lote</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Nome" required value={form.nome} onChange={(v) => setForm({ ...form, nome: v })} placeholder="Lote setembro/2026 - Shorts" />
          </div>
          <Input label="Data da compra" type="date" required value={form.data} onChange={(v) => setForm({ ...form, data: v })} />
          <Input label="Quantidade de peças" type="number" min="1" required value={form.qtd} onChange={(v) => setForm({ ...form, qtd: v })} />
          <Input label="Mercadoria (R$)" type="number" step="0.01" min="0" required value={form.mercadoria} onChange={(v) => setForm({ ...form, mercadoria: v })} />
          <Input label="Frete (R$)" type="number" step="0.01" min="0" required value={form.frete} onChange={(v) => setForm({ ...form, frete: v })} />
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">Categoria (opcional)</span>
            <select
              value={form.categoria}
              onChange={(e) => setForm({ ...form, categoria: e.target.value })}
              className="w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none"
            >
              <option value="">Nenhuma</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <Input label="Observações" value={form.obs} onChange={(v) => setForm({ ...form, obs: v })} />
        </div>
        {previa ? (
          <dl className="space-y-1 rounded-lg bg-primary-50 p-4 text-sm">
            <div className="flex justify-between"><dt className="text-ink-mute">Total do lote</dt><dd>{formatarReais(previa.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Custo unitário bruto</dt><dd>{formatarReais(Math.round(previa.bruto))}</dd></div>
            <div className="flex justify-between font-bold"><dt>Custo unitário arredondado</dt><dd>{formatarReais(previa.arred)}</dd></div>
          </dl>
        ) : (
          <p className="text-xs text-ink-mute">Preencha valores e quantidade para ver o custo unitário em tempo real.</p>
        )}
        <Button type="submit">Criar lote</Button>
      </form>

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-primary-50">
            <tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-mute">
              <th className="px-4 py-3">Lote</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Custo/un.</th>
              <th className="px-4 py-3">Produtos</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {lotes.map((l) => {
              const total = l.valor_mercadoria_centavos + l.valor_frete_centavos;
              const unit = l.quantidade_pecas > 0 ? Math.round(total / l.quantidade_pecas) : 0;
              const excede = l.produtosVinculados > l.quantidade_pecas;
              return (
                <tr key={l.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{l.nome}</p>
                    <p className="text-xs text-ink-mute">
                      {l.quantidade_pecas} peças
                      {excede && (
                        <span className="ml-2 font-semibold text-amber-700">
                          ⚠ mais produtos vinculados que peças do lote
                        </span>
                      )}
                    </p>
                  </td>
                  <td className="px-4 py-3">{formatarReais(total)}</td>
                  <td className="px-4 py-3">{formatarReais(unit)}</td>
                  <td className="px-4 py-3">{l.produtosVinculados}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/produtos?lote=${l.id}`} className="mr-3 text-xs font-semibold text-primary-700 hover:underline">
                      Ver produtos
                    </Link>
                    <button onClick={() => excluir(l)} className="text-xs text-red-600 hover:underline">
                      Excluir
                    </button>
                  </td>
                </tr>
              );
            })}
            {lotes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-mute">
                  Nenhum lote cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
