"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  arredondarCusto,
  calcularPrecoSugerido,
  custoTotalUnitario,
  custoUnitarioBruto,
  formatarReais,
} from "@/lib/precificacao";

type Config = {
  id: string;
  markup_padrao_percentual: number;
  regra_arredondamento_custo: string;
  regra_final_preco: string;
  rateio_frete: string;
  embalagem_entra_no_markup: boolean;
  margem_minima_percentual: number | null;
  taxa_pagamento_percentual: number | null;
};

type Material = {
  id: string;
  nome: string;
  custo_unitario_centavos: number;
  ativo: boolean;
  ordem: number;
};

const reaisParaCentavos = (v: string) =>
  Math.max(0, Math.round(Number(String(v).replace(",", ".")) * 100) || 0);
const centavosParaReais = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export default function PrecificacaoPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [materiais, setMateriais] = useState<Material[]>([]);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [novo, setNovo] = useState({ nome: "", modo: "unitario", unitario: "", qtd: "", total: "" });
  const [editando, setEditando] = useState<Record<string, string>>({});

  async function load() {
    const res = await fetch("/api/admin/precificacao");
    if (res.ok) {
      const d = await res.json();
      setConfig(d.config);
      setMateriais(d.materiais || []);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveConfig() {
    if (!config) return;
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/admin/precificacao", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markup_padrao_percentual: config.markup_padrao_percentual,
        regra_arredondamento_custo: config.regra_arredondamento_custo,
        regra_final_preco: config.regra_final_preco,
        rateio_frete: config.rateio_frete,
        embalagem_entra_no_markup: config.embalagem_entra_no_markup,
        margem_minima_percentual: config.margem_minima_percentual,
        taxa_pagamento_percentual: config.taxa_pagamento_percentual,
      }),
    });
    setMsg(res.ok ? "Configurações salvas." : "Erro ao salvar.");
    setSaving(false);
  }

  async function patchMaterial(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/admin/precificacao/materiais/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) load();
    else alert("Erro ao atualizar material");
  }

  async function criarMaterial() {
    const body: Record<string, unknown> = { nome: novo.nome };
    if (novo.modo === "unitario") {
      body.custo_unitario_centavos = reaisParaCentavos(novo.unitario);
    } else {
      body.quantidade_comprada = Number(novo.qtd) || 0;
      body.valor_total_comprado_centavos = reaisParaCentavos(novo.total);
    }
    const res = await fetch("/api/admin/precificacao/materiais", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setNovo({ nome: "", modo: "unitario", unitario: "", qtd: "", total: "" });
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Erro ao criar material");
    }
  }

  // Pré-visualização ao vivo com o exemplo da vendedora.
  const preview = useMemo(() => {
    if (!config) return null;
    try {
      const bruto = custoUnitarioBruto(30000, 3596, 17, "lote");
      const arred = Math.round(
        arredondarCusto(bruto, config.regra_arredondamento_custo as never)
      );
      const emb = materiais.filter((m) => m.ativo).reduce((s, m) => s + m.custo_unitario_centavos, 0);
      const total = custoTotalUnitario(arred, emb, 0);
      const calc = calcularPrecoSugerido(
        total,
        config.markup_padrao_percentual,
        config.regra_final_preco as never,
        {
          embalagemNoMarkup: !config.embalagem_entra_no_markup,
          custoPecaCentavos: arred,
          embalagemExtrasCentavos: emb,
        }
      );
      return { bruto, arred, emb, total, calc };
    } catch {
      return null;
    }
  }, [config, materiais]);

  if (!config) return <p className="text-ink-mute">Carregando precificação...</p>;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Precificação</h1>
          <p className="text-sm text-ink-mute">
            Regras do método da vendedora + custos de embalagem por peça.
          </p>
        </div>
        <Button onClick={saveConfig} disabled={saving}>
          {saving ? "Salvando..." : "Salvar tudo"}
        </Button>
      </div>
      {msg && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{msg}</p>}

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="font-semibold text-ink">Regras de cálculo</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input
            label="Ganho padrão / markup (%)"
            type="number"
            min="0"
            value={String(config.markup_padrao_percentual)}
            onChange={(v) =>
              setConfig({ ...config, markup_padrao_percentual: Number(v) || 0 })
            }
          />
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">
              Arredondamento do custo
            </span>
            <select
              value={config.regra_arredondamento_custo}
              onChange={(e) =>
                setConfig({ ...config, regra_arredondamento_custo: e.target.value })
              }
              className="w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none"
            >
              <option value="inteiro_para_cima">Real inteiro para cima (protege a margem)</option>
              <option value="inteiro_mais_proximo">Real inteiro mais próximo</option>
              <option value="multiplo_de_X">Múltiplo de R$ 0,50</option>
              <option value="nenhum">Nenhum (custo exato)</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">
              Final do preço
            </span>
            <select
              value={config.regra_final_preco}
              onChange={(e) => setConfig({ ...config, regra_final_preco: e.target.value })}
              className="w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none"
            >
              <option value="termina_99">Termina em ,99</option>
              <option value="nenhuma">Sem ajuste (preço bruto)</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">
              Rateio do frete
            </span>
            <select
              value={config.rateio_frete}
              onChange={(e) => setConfig({ ...config, rateio_frete: e.target.value })}
              className="w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none"
            >
              <option value="igual">Igual entre as peças</option>
              <option value="proporcional_ao_custo">Proporcional ao custo</option>
            </select>
          </label>
          <Input
            label="Margem mínima p/ alerta (%) — vazio = sem limite"
            type="number"
            min="0"
            value={config.margem_minima_percentual === null ? "" : String(config.margem_minima_percentual)}
            onChange={(v) =>
              setConfig({
                ...config,
                margem_minima_percentual: v === "" ? null : Number(v) || 0,
              })
            }
          />
          <Input
            label="Taxa do pagamento (%) — vazio = sem taxa"
            type="number"
            min="0"
            value={config.taxa_pagamento_percentual === null ? "" : String(config.taxa_pagamento_percentual)}
            onChange={(v) =>
              setConfig({
                ...config,
                taxa_pagamento_percentual: v === "" ? null : Number(v) || 0,
              })
            }
          />
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={config.embalagem_entra_no_markup}
            onChange={(e) =>
              setConfig({ ...config, embalagem_entra_no_markup: e.target.checked })
            }
          />
          <span>
            <strong>Embalagem entra no markup</strong> (ganho de 100% sobre tudo que gastou).
            Desmarcado: a embalagem é repassada sem lucro.
          </span>
        </label>
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="font-semibold text-ink">Materiais de embalagem (custo por peça)</h2>
        <p className="text-xs text-ink-mute">
          Preencha o custo unitário de cada material. Enquanto zerados, o preço sugerido sai subestimado.
        </p>
        <div className="mt-3 space-y-2">
          {materiais.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-ink/10 p-3">
              <span className="min-w-40 flex-1 text-sm font-medium text-ink">{m.nome}</span>
              <input
                className="w-28 rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none"
                type="number"
                step="0.01"
                min="0"
                title="Custo unitário (R$)"
                value={editando[m.id] ?? centavosParaReais(m.custo_unitario_centavos)}
                onChange={(e) => setEditando({ ...editando, [m.id]: e.target.value })}
                onBlur={(e) => {
                  const v = reaisParaCentavos(e.target.value);
                  if (v !== m.custo_unitario_centavos) {
                    patchMaterial(m.id, { custo_unitario_centavos: v });
                  }
                  setEditando((ed) => {
                    const c = { ...ed };
                    delete c[m.id];
                    return c;
                  });
                }}
              />
              <label className="flex items-center gap-1 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={m.ativo}
                  onChange={(e) => patchMaterial(m.id, { ativo: e.target.checked })}
                />
                ativo
              </label>
            </div>
          ))}
          {materiais.length === 0 && (
            <p className="text-sm text-ink-mute">Nenhum material cadastrado.</p>
          )}
        </div>
        <div className="mt-4 rounded-lg bg-primary-50 p-4">
          <p className="text-sm font-semibold text-ink">Novo material</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Input label="Nome" value={novo.nome} onChange={(v) => setNovo({ ...novo, nome: v })} />
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">Modo</span>
              <select
                value={novo.modo}
                onChange={(e) => setNovo({ ...novo, modo: e.target.value })}
                className="w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none"
              >
                <option value="unitario">Custo por unidade</option>
                <option value="compra">Comprei X unidades por R$ Y</option>
              </select>
            </label>
            {novo.modo === "unitario" ? (
              <Input label="Custo unitário (R$)" type="number" step="0.01" min="0" value={novo.unitario} onChange={(v) => setNovo({ ...novo, unitario: v })} />
            ) : (
              <>
                <Input label="Quantidade comprada" type="number" min="1" value={novo.qtd} onChange={(v) => setNovo({ ...novo, qtd: v })} />
                <Input label="Valor total pago (R$)" type="number" step="0.01" min="0" value={novo.total} onChange={(v) => setNovo({ ...novo, total: v })} />
              </>
            )}
          </div>
          <div className="mt-3">
            <Button size="sm" onClick={criarMaterial} disabled={!novo.nome.trim()}>
              Adicionar material
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="font-semibold text-ink">Pré-visualização ao vivo</h2>
        <p className="text-xs text-ink-mute">
          Exemplo da anotação da vendedora: mercadoria R$ 300,00 + frete R$ 35,96, 17 peças.
        </p>
        {preview ? (
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-ink-mute">Custo unitário bruto</dt><dd>{formatarReais(Math.round(preview.bruto))}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Custo arredondado</dt><dd>{formatarReais(preview.arred)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Embalagem por peça</dt><dd>{formatarReais(preview.emb)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Custo total</dt><dd>{formatarReais(preview.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Preço bruto ({config.markup_padrao_percentual}%)</dt><dd>{formatarReais(preview.calc.precoBrutoCentavos)}</dd></div>
            <div className="flex justify-between font-bold"><dt>Preço sugerido</dt><dd>{formatarReais(preview.calc.precoSugeridoCentavos)}</dd></div>
          </dl>
        ) : (
          <p className="mt-3 text-sm text-red-600">Não foi possível calcular o exemplo.</p>
        )}
      </section>
    </div>
  );
}
