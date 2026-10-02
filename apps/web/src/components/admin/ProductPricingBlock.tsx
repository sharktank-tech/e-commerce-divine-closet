"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { reaisParaCentavosTexto } from "@/lib/moeda-input";
import {
  arredondarCusto,
  calcularPrecoSugerido,
  custoTotalUnitario,
  custoUnitarioBruto,
  formatarReais,
  metricasVenda,
  verificarAlertaPrejuizo,
  alertaEmbalagemNaoConfigurada,
} from "@/lib/precificacao";

export type PricingState = {
  origem: "nenhuma" | "lote" | "manual";
  loteId: string;
  custoManual: string; // R$
  markup: string; // % (vazio = padrão)
  extras: string; // R$
  extrasDescricao: string;
};

export const emptyPricing: PricingState = {
  origem: "nenhuma",
  loteId: "",
  custoManual: "",
  markup: "",
  extras: "",
  extrasDescricao: "",
};

type Lote = {
  id: string;
  nome: string;
  valor_mercadoria_centavos: number;
  valor_frete_centavos: number;
  quantidade_pecas: number;
};

type Props = {
  value: PricingState;
  onChange: (v: PricingState) => void;
  /** preço de venda atual do campo (R$) — o painel reflete este valor */
  precoVenda: string;
  onUsarSugerido: (precoReais: string) => void;
  /** preço promocional atual (R$), se houver */
  precoPromo?: string;
  /** snapshots já gravados (edição de produto precificado) */
  snapshot?: {
    custo_peca_centavos: number | null;
    custo_embalagem_centavos: number | null;
    preco_sugerido_centavos: number | null;
    precificacao_calculada_em: string | null;
  } | null;
};

export function ProductPricingBlock({ value, onChange, precoVenda, onUsarSugerido, precoPromo, snapshot }: Props) {
  const [open, setOpen] = useState(false);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [markupPadrao, setMarkupPadrao] = useState(100);
  const [regraArred, setRegraArred] = useState("inteiro_para_cima");
  const [regraFinal, setRegraFinal] = useState("termina_99");
  const [embalagemNoMarkup, setEmbalagemNoMarkup] = useState(false);
  const [margemMinima, setMargemMinima] = useState<number | null>(null);
  const [embalagem, setEmbalagem] = useState(0);

  useEffect(() => {
    Promise.all([fetch("/api/admin/lotes"), fetch("/api/admin/precificacao")]).then(
      async ([lotesRes, cfgRes]) => {
        if (lotesRes.ok) setLotes((await lotesRes.json()).items || []);
        if (cfgRes.ok) {
          const d = await cfgRes.json();
          const c = d.config;
          setMarkupPadrao(c.markup_padrao_percentual ?? 100);
          setRegraArred(c.regra_arredondamento_custo || "inteiro_para_cima");
          setRegraFinal(c.regra_final_preco || "termina_99");
          setEmbalagemNoMarkup(!c.embalagem_entra_no_markup);
          setMargemMinima(c.margem_minima_percentual);
          const mats = (d.materiais || []).filter((m: { ativo: boolean }) => m.ativo);
          setEmbalagem(mats.reduce((s: number, m: { custo_unitario_centavos: number }) => s + m.custo_unitario_centavos, 0));
        }
      }
    );
  }, []);

  const calc = useMemo(() => {
    try {
      let custoPeca = 0;
      let origemOk = false;
      if (value.origem === "lote" && value.loteId) {
        const lote = lotes.find((l) => l.id === value.loteId);
        if (!lote) return null;
        const bruto = custoUnitarioBruto(
          lote.valor_mercadoria_centavos,
          lote.valor_frete_centavos,
          lote.quantidade_pecas,
          "lote"
        );
        custoPeca = Math.round(arredondarCusto(bruto, regraArred as never));
        origemOk = true;
      } else if (value.origem === "manual" && value.custoManual !== "") {
        custoPeca = reaisParaCentavosTexto(value.custoManual);
        origemOk = true;
      }
      if (!origemOk) return null;
      const markup = value.markup === "" ? markupPadrao : Number(value.markup) || 0;
      const extras = reaisParaCentavosTexto(value.extras);
      const total = custoTotalUnitario(custoPeca, embalagem, extras);
      const sug = calcularPrecoSugerido(total, markup, regraFinal as never, {
        embalagemNoMarkup,
        custoPecaCentavos: custoPeca,
        embalagemExtrasCentavos: embalagem + extras,
      });
      return { custoPeca, embalagem, extras, total, markup, sug };
    } catch {
      return null;
    }
  }, [value, lotes, markupPadrao, regraArred, regraFinal, embalagemNoMarkup, embalagem]);

  const vendaCentavos = reaisParaCentavosTexto(precoVenda);
  const metVenda = calc ? metricasVenda(vendaCentavos, calc.total, 0) : null;
  const alertaPrejuizo = calc ? verificarAlertaPrejuizo(vendaCentavos, calc.total) : null;
  const alertaEmb = alertaEmbalagemNaoConfigurada(embalagem);
  const promoCentavos = precoPromo ? reaisParaCentavosTexto(precoPromo) : 0;
  const metPromo = calc && promoCentavos > 0 ? metricasVenda(promoCentavos, calc.total, 0) : null;
  const abaixoMinima =
    margemMinima !== null && metVenda ? metVenda.margemRealPercentual < margemMinima : false;

  const loteSelecionado = lotes.find((l) => l.id === value.loteId);

  return (
    <div className="border-t border-ink/10 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-xs font-medium uppercase tracking-wide text-ink-mute"
      >
        <span>Precificação (sugestão de preço)</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {snapshot?.precificacao_calculada_em && !open && (
        <p className="mt-1 text-xs text-ink-mute">
          Último cálculo: {formatarReais(snapshot.preco_sugerido_centavos || 0)} sugeridos.
        </p>
      )}
      {open && (
        <div className="mt-3 space-y-4 rounded-xl bg-primary-50/60 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">Origem do custo</span>
              <select
                value={value.origem}
                onChange={(e) =>
                  onChange({ ...value, origem: e.target.value as PricingState["origem"] })
                }
                className="w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none"
              >
                <option value="nenhuma">Sem cálculo (só preço manual)</option>
                <option value="lote">Usar lote de compra</option>
                <option value="manual">Informar custo manualmente</option>
              </select>
            </label>
            {value.origem === "lote" && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">Lote</span>
                <select
                  value={value.loteId}
                  onChange={(e) => onChange({ ...value, loteId: e.target.value })}
                  className="w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none"
                >
                  <option value="">Selecione...</option>
                  {lotes.map((l) => (
                    <option key={l.id} value={l.id}>{l.nome}</option>
                  ))}
                </select>
              </label>
            )}
            {value.origem === "manual" && (
              <Input
                label="Custo da peça (R$)"
                type="number"
                step="0.01"
                min="0"
                value={value.custoManual}
                onChange={(v) => onChange({ ...value, custoManual: v })}
              />
            )}
            <Input
              label={`Ganho deste produto (%) — padrão ${markupPadrao}`}
              type="number"
              min="0"
              value={value.markup}
              onChange={(v) => onChange({ ...value, markup: v })}
              placeholder={String(markupPadrao)}
            />
            <Input
              label="Custos extras (R$)"
              type="number"
              step="0.01"
              min="0"
              value={value.extras}
              onChange={(v) => onChange({ ...value, extras: v })}
            />
            <Input
              label="Descrição dos extras"
              value={value.extrasDescricao}
              onChange={(v) => onChange({ ...value, extrasDescricao: v })}
              placeholder="Ex.: bordado personalizado"
            />
          </div>

          {loteSelecionado && value.origem === "lote" && (
            <p className="text-xs text-ink-mute">
              Lote: {formatarReais(loteSelecionado.valor_mercadoria_centavos + loteSelecionado.valor_frete_centavos)} ÷{" "}
              {loteSelecionado.quantidade_pecas} peças.
            </p>
          )}

          {calc ? (
            <>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-ink-mute">Custo da peça (arredondado)</dt><dd>{formatarReais(calc.custoPeca)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-mute">Embalagem por peça</dt><dd>{formatarReais(calc.embalagem)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-mute">Custos extras</dt><dd>{formatarReais(calc.extras)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-mute">Custo total</dt><dd>{formatarReais(calc.total)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-mute">Ganho aplicado ({calc.markup}%)</dt><dd>{formatarReais(calc.sug.precoBrutoCentavos - calc.total)}</dd></div>
                <div className="flex justify-between font-bold"><dt>Preço sugerido</dt><dd>{formatarReais(calc.sug.precoSugeridoCentavos)}</dd></div>
              </dl>
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  onUsarSugerido((calc.sug.precoSugeridoCentavos / 100).toFixed(2))
                }
              >
                Usar este preço
              </Button>

              {metVenda && (
                <div className="rounded-lg bg-white p-3 text-sm">
                  <p className="font-semibold text-ink">
                    No preço atual ({formatarReais(vendaCentavos)}):
                  </p>
                  <p className="text-ink-soft">
                    Lucro {formatarReais(metVenda.lucroPorPecaCentavos)} · markup {metVenda.markupRealPercentual}% · margem {metVenda.margemRealPercentual}%
                  </p>
                  <p className="mt-1 text-xs text-ink-mute">
                    Ganho de 100% sobre o custo equivale a margem de 50% sobre o preço de venda.
                  </p>
                  {alertaPrejuizo?.alert && (
                    <p className="mt-2 font-semibold text-red-600">⚠ {alertaPrejuizo.mensagem}</p>
                  )}
                  {abaixoMinima && (
                    <p className="mt-1 font-semibold text-amber-700">
                      ⚠ Margem abaixo da mínima configurada ({margemMinima}%).
                    </p>
                  )}
                  {alertaEmb.alert && (
                    <p className="mt-1 text-amber-700">
                      ⚠ {alertaEmb.mensagem} — <a href="/admin/precificacao" className="underline">configurar</a>.
                    </p>
                  )}
                </div>
              )}
              {metPromo && (
                <p className="text-sm text-ink-soft">
                  No promocional ({formatarReais(promoCentavos)}): lucro {formatarReais(metPromo.lucroPorPecaCentavos)} · margem {metPromo.margemRealPercentual}%
                  {promoCentavos < (calc?.total || 0) && (
                    <span className="font-semibold text-red-600"> — abaixo do custo!</span>
                  )}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-mute">
              Escolha um lote ou informe o custo para ver a sugestão.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
