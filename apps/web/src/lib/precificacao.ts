// Precificação Divine Closet
// Regras do método da vendedora, com flags configuráveis.
// Todo o cálculo usa centavos (inteiros) para evitar erros de float.

/** Regra de arredondamento do custo unitário */
export type RegraArredondamentoCusto = 'nenhum' | 'inteiro_mais_proximo' | 'inteiro_para_cima' | 'multiplo_de_X'

/** Regra de formatação do preço final */
export type RegraFinalPreco = 'termina_99' | 'nenhum'

/** Modo de rateio do frete */
export type RateioFrete = 'igual' | 'proporcional_ao_custo'

/** Se a embalagem entra no cálculo do markup */
export type EmbalagemNoMarkup = true | false

/**
 * 4.1 Custo unitário bruto da peça
 * - Modo lote (padrão): (mercadoria + frete) / quantidade_pecas, sem arredondar ainda
 * - Modo manual: custo_peca_manual digitado
 *
 * O retorno é em centavos, podendo ser fracionário (ex.: 1976.2353).
 * A etapa 4.2 decide o arredondamento. `quantidade_pecas <= 0` é erro
 * de validação (nunca silencioso).
 */
export function custoUnitarioBruto(
  mercadoriaCentavos: number,
  freteCentavos: number,
  quantidadePecas: number,
  modo: 'lote' | 'manual' = 'lote',
  custoPecaManual?: number
): number {
  if (modo === 'manual' && custoPecaManual !== undefined) {
    return Math.max(0, custoPecaManual)
  }
  if (!Number.isFinite(quantidadePecas) || quantidadePecas <= 0) {
    throw new Error('quantidade_pecas deve ser maior que zero')
  }
  // Modo lote: (mercadoria + frete) / quantidade_pecas
  const total = mercadoriaCentavos + freteCentavos
  return total / quantidadePecas
}

/**
 * 4.1b Rateio proporcional do frete (opcional).
 * Quando as peças do lote têm custos diferentes, o frete é distribuído
 * proporcionalmente ao custo de cada peça:
 *   frete_da_peca = frete_total × (custo_da_peca / soma_custos_pecas)
 * Todos os valores em centavos (o frete rateado pode ser fracionário).
 */
export function ratearFreteProporcional(
  custosPecasCentavos: number[],
  freteTotalCentavos: number
): number[] {
  const soma = custosPecasCentavos.reduce((s, c) => s + c, 0)
  if (custosPecasCentavos.length === 0 || soma <= 0) {
    throw new Error('informe ao menos uma peça com custo positivo para ratear o frete')
  }
  return custosPecasCentavos.map((c) => (freteTotalCentavos * c) / soma)
}

/**
 * 4.2 Arredondamento do custo (regra da vendedora: R$ 19,76 → R$ 20,00)
 * Atenção às unidades: a entrada é em CENTAVOS, mas "inteiro" aqui significa
 * REAL inteiro (a moeda da anotação dela). Ou seja:
 * - `inteiro_para_cima`: 1976.2353 centavos → 2000 centavos (R$ 20,00)
 * - `inteiro_mais_proximo`: 1976.2353 centavos → 2000 centavos
 * - `multiplo_de_X`: teto para o próximo múltiplo de X centavos
 *   (ex.: X=50 arredonda para múltiplos de R$ 0,50)
 * - `nenhum`: mantém o valor, arredondado ao centavo mais próximo
 */
export function arredondarCusto(
  custoBrutoCentavos: number,
  regra: RegraArredondamentoCusto = 'inteiro_para_cima',
  multiploCentavos = 50
): number {
  switch (regra) {
    case 'nenhum':
      // Mantém o valor, apenas normaliza para o centavo mais próximo.
      return Math.round(custoBrutoCentavos * 100) / 100

    case 'inteiro_mais_proximo':
      // Real inteiro mais próximo (ex.: R$ 19,76 → R$ 20,00).
      return Math.round(custoBrutoCentavos / 100) * 100

    case 'inteiro_para_cima':
      // Sempre para o próximo real inteiro (protege a margem).
      // Subtrai um epsilon para que valores já inteiros não subam à toa
      // por causa de erro binário de float (ex.: 2000.0000001).
      return Math.ceil(custoBrutoCentavos / 100 - 1e-9) * 100

    case 'multiplo_de_X': {
      const x = Math.max(1, Math.round(multiploCentavos))
      return Math.ceil(custoBrutoCentavos / x - 1e-9) * x
    }

    default:
      return Math.ceil(custoBrutoCentavos / 100 - 1e-9) * 100
  }
}

/**
 * 4.3 Custo total unitário (inclui embalagem e custos extras)
 * custo_peca_arredondado + soma(materiais_embalagem ativos) + custos_extras_do_produto
 */
export function custoTotalUnitario(
  custoPecaArredondado: number,
  custosEmbalagemCentavos: number,
  custosExtrasCentavos: number
): number {
  return custoPecaArredondado + custosEmbalagemCentavos + custosExtrasCentavos
}

/**
 * 4.4 Preço bruto e preço sugerido final
 * preco_bruto = custo_total_unitario × (1 + markup/100)
 * regra_final_preco:
 *   - termina_99: Math.ceil(preço_bruto_em_reais) − R$ 0,01
 *     exemplo: R$ 40,00 → R$ 39,99; R$ 44,80 → R$ 44,99; R$ 40,01 → R$ 40,99
 *     No cálculo em centavos:
 *     - precoBrutoCentavos = Math.round(custoTotal * (1 + markup/100))
     - precoEmReais = precoBrutoCentavos / 100
     - ceilEmReais = Math.ceil(precoEmReais)
     - sugeridoEmReais = ceilEmReais - 0.01
     - sugeridoEmCentavos = Math.round(sugeridoEmReais * 100)
 *   - nenhuma: preço bruto arredondado ao centavo
 */
export interface CalculoPrecoResultado {
  precoBrutoCentavos: number
  precoSugeridoCentavos: number
  lucroPorPecaCentavos: number
  markupRealPercentual: number
  margemRealPercentual: number
}

/**
 Calcula o preço sugerido com base nas regras.
 Por padrão (`embalagemNoMarkup=false`), o markup incide sobre o custo total,
 incluindo embalagem (“ganho sobre tudo que gastei”).
 Com `embalagemNoMarkup=true`, a embalagem/extras são repassados sem lucro:
   preco_bruto = custo_peca × (1 + markup) + embalagem + extras
 Nesse segundo modo, informe `custoPecaCentavos` e `embalagemExtrasCentavos`
 separadamente (a soma dos dois deve equivaler ao custo total).
 */
export function calcularPrecoSugerido(
  custoTotalUnitarioCentavos: number,
  markupPercentual: number,
  regraFinalPreco: RegraFinalPreco = 'termina_99',
  opts: {
    embalagemNoMarkup?: boolean
    custoPecaCentavos?: number
    embalagemExtrasCentavos?: number
  } = {}
): CalculoPrecoResultado {
  // preço bruto = custo × (1 + markup/100)
  // Com Math.round na saída, o resultado final é sempre centavo inteiro.
  const precoBrutoCentavos = opts.embalagemNoMarkup
    ? Math.round((opts.custoPecaCentavos ?? 0) * (1 + markupPercentual / 100)) +
      Math.round(opts.embalagemExtrasCentavos ?? 0)
    : Math.round(custoTotalUnitarioCentavos * (1 + markupPercentual / 100))

  let precoSugeridoCentavos: number
  if (regraFinalPreco === 'termina_99') {
    // Conversão para reais, aplicação do ceil, subtração de 0,01, conversão de volta
    const precoEmReais = precoBrutoCentavos / 100
    const ceilEmReais = Math.ceil(precoEmReais)
    const sugeridoEmReais = ceilEmReais - 0.01
    precoSugeridoCentavos = Math.round(sugeridoEmReais * 100)
    // safety: se ficar negativo (ex.: preço bruto = 1 centavo), usa o próprio bruto
    if (precoSugeridoCentavos < 1) precoSugeridoCentavos = precoBrutoCentavos
  } else {
    // nenhuma: bruto arredondado ao centavo
    precoSugeridoCentavos = precoBrutoCentavos
  }

  // métricas sobre o preço sugerido (percentuais com 2 casas decimais)
  const lucroPorPecaCentavos = precoSugeridoCentavos - custoTotalUnitarioCentavos
  const markupRealPercentual = custoTotalUnitarioCentavos > 0
    ? round2((lucroPorPecaCentavos / custoTotalUnitarioCentavos) * 100)
    : 0
  const margemRealPercentual = precoSugeridoCentavos > 0
    ? round2((lucroPorPecaCentavos / precoSugeridoCentavos) * 100)
    : 0

  return {
    precoBrutoCentavos,
    precoSugeridoCentavos,
    lucroPorPecaCentavos,
    markupRealPercentual,
    margemRealPercentual,
  }
}

/** arredonda percentual para 2 casas decimais (ex.: 99.95) */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 4.5 Métricas exibidas (sempre calculadas sobre o preço de venda efetivo)
 * - lucro_por_peca = preco_venda − custo_total_unitario − taxa_pagamento
 * - markup_real = lucro / custo_total_unitario
 * - margem_real = lucro / preco_venda
 * - Lembrete: ganho de 100% sobre o custo equivale a margem de 50% sobre o preço de venda.
 */
export function metricasVenda(
  precoVendaCentavos: number,
  custoTotalUnitarioCentavos: number,
  taxaPagamentoCentavos: number = 0
) {
  const lucroPorPecaCentavos = precoVendaCentavos - custoTotalUnitarioCentavos - taxaPagamentoCentavos
  const markupRealPercentual = custoTotalUnitarioCentavos > 0
    ? round2((lucroPorPecaCentavos / custoTotalUnitarioCentavos) * 100)
    : 0
  const margemRealPercentual = precoVendaCentavos > 0
    ? round2((lucroPorPecaCentavos / precoVendaCentavos) * 100)
    : 0

  return {
    lucroPorPecaCentavos,
    markupRealPercentual,
    margemRealPercentual,
  }
}

/**
 * 4.6 Taxa do meio de pagamento (opcional)
 * Se taxa_pagamento_percentual estiver definida, subtrai-a do lucro.
 * Se não estiver definida (0 ou null), não afeta o cálculo.
 */
export function lucroLigadoAtaxa(
  precoVendaCentavos: number,
  custoTotalUnitarioCentavos: number,
  taxaPercentual: number = 0
) {
  const taxaCentavos = Math.round((precoVendaCentavos * taxaPercentual) / 100)
  return precoVendaCentavos - custoTotalUnitarioCentavos - taxaCentavos
}

/**
 * 4.7 Alertas (não bloqueiam o salvamento)
 */
export function verificarAlertaPrejuizo(
  precoVendaCentavos: number,
  custoTotalUnitarioCentavos: number
): { alert: boolean; mensagem: string } {
  if (precoVendaCentavos < custoTotalUnitarioCentavos) {
    return { alert: true, mensagem: "Preço de venda abaixo do custo total: prejuízo certo." }
  }
  if (precoVendaCentavos < custoTotalUnitarioCentavos * 1.05) {
    return {
      alert: true,
      mensagem:
        "Atenção: preço próximo do custo, margem muito reduzida.",
    }
  }
  return { alert: false, mensagem: "OK" }
}

/**
 * 4.7 Alerta de embalagem não configurada
 */
export function alertaEmbalagemNaoConfigurada(
  custosEmbalagemCentavos: number
): { alert: boolean; mensagem: string } {
  if (custosEmbalagemCentavos === 0) {
    return {
      alert: true,
      mensagem:
        "Custos de embalagem ainda não configurados. O preço sugerido pode estar baixo.",
    }
  }
  return { alert: false, mensagem: "OK" }
}

/**
 * Helper: formata número de centavos em R$ (interface apenas, usa vírgula brasileira).
 * Ex.: 3999 → 'R$ 39,99'
 * Ex.: -100 → '-R$ 1,00'
 */
export function formatarReais(centavos: number): string {
  const negativo = centavos < 0
  const abs = Math.abs(centavos)
  const reais = Math.floor(abs / 100)
  const cent = abs % 100
  const parte = `${reais},${cent.toString().padStart(2, "0")}`
  if (negativo) return `-R$ ${parte}`
  return `R$ ${parte}`
}

/**
 * Helper: formata número de centavos em R$ com milhar (interface apenas)
 */
export function formatarReaisPonto(centavos: number): string {
  const sinal = centavos < 0 ? "-" : ""
  const abs = Math.abs(centavos)
  const reais = abs / 100
  return `${sinal}R$ ${reais.toFixed(2).replace(".", ",")}`
}

/* --- Casos de teste (modo puro, sem UI) --- */

// Caso 1: Lote da vendedora (seção 4.1 do espec)
// mercadoria 30000, frete 3596, 17 peças
// custo unitário bruto = (30000 + 3596) / 17 = 1976.2353 centavos
// arredondado (inteiro_para_cima, em reais) = 2000 centavos (R$ 20,00)
// preço bruto = 2000 × 2 = 4000 → sugerido 3999 (R$ 39,99)
// lucro = 3999 − 2000 = 1999; markup = 99.95%; margem = 49.99%

// Caso 2: Mesmo lote, arredondamento 'nenhum'
// custo bruto 1976.24 (normalizado ao centavo)
// preço bruto = 1976.24 × 2 = 3952.48 → 3952 centavos (R$ 39,52)
// termina_99: Math.ceil(39.52) = 40, 40 − 0.01 = 39.99 → 3999

// Caso 3: Com embalagem ilustrativa: custo 2000 + 240 (embalagem) = 2240, markup 100, termina_99
// preço bruto = 2240 × 2 = 4480 centavos (R$ 44,80)
// Math.ceil(44.80) = 45, 45 − 0.01 = 44.99 → 4499 centavos = R$ 44,99 ✓

// Caso 4: Mesmo, embalagem fora do markup
// preço_bruto = (2000 × 2) + 240 = 4240 centavos (R$ 42,40)
// Math.ceil(42.40) = 43, 43 − 0.01 = 42.99 → 4299 centavos = R$ 42,99 ✓

// Caso 5: Alerta de prejuízo
// verificarAlertaPrejuizo(1999, 2240) → { alert: true, ... }

// Caso 6: Margens
// metricasVenda(3999, 2000, 0) → { lucro: 1999, markup: 99.95, margem: 49.99 }
// Lembrete: ganho de 100% sobre custo (R$ 20 lucro sobre R$ 20 custo) = margem de ~50% sobre preço R$ 40

// Caso 7: Rateio proporcional do frete
// ratearFreteProporcional([1000, 3000], 400) → [100, 300]

// Caso 8: formatarReais
// formatarReais(3999) = "R$ 39,99"
// formatarReais(1050) = "R$ 10,50"
// formatarReais(0) = "R$ 0,00"