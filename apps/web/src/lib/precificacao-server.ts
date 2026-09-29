import { prisma } from "@/lib/prisma";
import {
  arredondarCusto,
  calcularPrecoSugerido,
  custoTotalUnitario,
  custoUnitarioBruto,
  metricasVenda,
  type RegraArredondamentoCusto,
  type RegraFinalPreco,
} from "@/lib/precificacao";

export type PricingConfig = {
  markupPadrao: number;
  regraArredondamento: RegraArredondamentoCusto;
  regraFinalPreco: RegraFinalPreco;
  embalagemNoMarkup: boolean;
  margemMinima: number | null;
  taxaPagamento: number | null;
};

export type MaterialAtivo = { id: string; nome: string; custoCentavos: number };

export async function getPricingConfig(): Promise<PricingConfig> {
  try {
    const row = await prisma.configPrecificacao.findFirst();
    if (!row) {
      return {
        markupPadrao: 100,
        regraArredondamento: "inteiro_para_cima",
        regraFinalPreco: "termina_99",
        embalagemNoMarkup: false,
        margemMinima: null,
        taxaPagamento: null,
      };
    }
    return {
      markupPadrao: row.markup_padrao_percentual,
      regraArredondamento: (row.regra_arredondamento_custo ||
        "inteiro_para_cima") as RegraArredondamentoCusto,
      regraFinalPreco: (row.regra_final_preco || "termina_99") as RegraFinalPreco,
      embalagemNoMarkup: !row.embalagem_entra_no_markup,
      margemMinima: row.margem_minima_percentual,
      taxaPagamento: row.taxa_pagamento_percentual,
    };
  } catch {
    return {
      markupPadrao: 100,
      regraArredondamento: "inteiro_para_cima",
      regraFinalPreco: "termina_99",
      embalagemNoMarkup: false,
      margemMinima: null,
      taxaPagamento: null,
    };
  }
}

export async function getMateriaisAtivos(): Promise<MaterialAtivo[]> {
  try {
    const rows = await prisma.materiaisEmbalagem.findMany({
      where: { ativo: true },
      orderBy: { ordem: "asc" },
    });
    return rows.map((m) => ({
      id: m.id,
      nome: m.nome,
      custoCentavos: m.custo_unitario_centavos,
    }));
  } catch {
    return [];
  }
}

export type SnapshotInput = {
  loteId?: string | null;
  custoPecaManualCentavos?: number | null;
  markupProduto?: number | null;
  custosExtrasCentavos?: number;
  custosExtrasDescricao?: string | null;
};

export type Snapshot = {
  custoPeca: number;
  custoEmbalagem: number;
  custosExtras: number;
  custoTotal: number;
  markup: number;
  precoBruto: number;
  precoSugerido: number;
  lucro: number;
  markupReal: number;
  margemReal: number;
  origem: "lote" | "manual" | "nenhuma";
};

/**
 * Calcula o snapshot de precificação a partir das entradas do admin,
 * usando config + materiais atuais. Não grava nada; só calcula.
 */
export async function calcularSnapshot(input: SnapshotInput): Promise<Snapshot | null> {
  const [config, materiais] = await Promise.all([getPricingConfig(), getMateriaisAtivos()]);
  const markup = input.markupProduto ?? config.markupPadrao;
  const extras = Math.max(0, Math.round(input.custosExtrasCentavos ?? 0));
  const embalagem = materiais.reduce((s, m) => s + Math.max(0, m.custoCentavos), 0);

  let custoPeca = 0;
  let origem: Snapshot["origem"] = "nenhuma";

  if (input.loteId) {
    const lote = await prisma.loteCompra.findUnique({ where: { id: input.loteId } });
    if (!lote) return null;
    const bruto = custoUnitarioBruto(
      lote.valor_mercadoria_centavos,
      lote.valor_frete_centavos,
      lote.quantidade_pecas,
      "lote"
    );
    custoPeca = Math.round(arredondarCusto(bruto, config.regraArredondamento));
    origem = "lote";
  } else if (input.custoPecaManualCentavos !== undefined && input.custoPecaManualCentavos !== null) {
    custoPeca = Math.max(0, Math.round(input.custoPecaManualCentavos));
    origem = "manual";
  } else {
    return null;
  }

  const custoTotal = custoTotalUnitario(custoPeca, embalagem, extras);
  const calc = calcularPrecoSugerido(custoTotal, markup, config.regraFinalPreco, {
    embalagemNoMarkup: config.embalagemNoMarkup,
    custoPecaCentavos: custoPeca,
    embalagemExtrasCentavos: embalagem + extras,
  });
  const met = metricasVenda(calc.precoSugeridoCentavos, custoTotal, 0);

  return {
    custoPeca,
    custoEmbalagem: embalagem,
    custosExtras: extras,
    custoTotal,
    markup,
    precoBruto: calc.precoBrutoCentavos,
    precoSugerido: calc.precoSugeridoCentavos,
    lucro: met.lucroPorPecaCentavos,
    markupReal: met.markupRealPercentual,
    margemReal: met.margemRealPercentual,
    origem,
  };
}

/** Métricas sobre um preço de venda efetivo (sugerido ou digitado). */
export async function metricasSobrePreco(
  precoVendaCentavos: number,
  custoTotalCentavos: number
) {
  const config = await getPricingConfig();
  const taxaCentavos = config.taxaPagamento
    ? Math.round((precoVendaCentavos * config.taxaPagamento) / 100)
    : 0;
  const met = metricasVenda(precoVendaCentavos, custoTotalCentavos, taxaCentavos);
  const abaixoMinima =
    config.margemMinima !== null && met.margemRealPercentual < config.margemMinima;
  return { ...met, taxaCentavos, abaixoMinima, margemMinima: config.margemMinima };
}
