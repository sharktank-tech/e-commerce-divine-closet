import { describe, expect, it } from "vitest"
import {
  custoUnitarioBruto,
  ratearFreteProporcional,
  arredondarCusto,
  custoTotalUnitario,
  calcularPrecoSugerido,
  metricasVenda,
  verificarAlertaPrejuizo,
  alertaEmbalagemNaoConfigurada,
  formatarReais,
} from "../precificacao"

describe("custoUnitarioBruto", () => {
  it("modo lote: (30000 + 3596) / 17 = 1976,2353 centavos", () => {
    const result = custoUnitarioBruto(30000, 3596, 17, "lote")
    // 33596 / 17 = 1976.235294117...
    expect(result).toBeCloseTo(1976.2353, 4)
  })

  it("modo manual: custo informado deve ser retornado", () => {
    const result = custoUnitarioBruto(0, 0, 0, "manual", 2000)
    expect(result).toBe(2000)
  })

  it("quantidade de peças = 1 retorna total da mercadoria + frete", () => {
    const result = custoUnitarioBruto(1000, 500, 1, "lote")
    expect(result).toBe(1500)
  })

  it("quantidade de peças = 0 é erro de validação", () => {
    expect(() => custoUnitarioBruto(30000, 3596, 0, "lote")).toThrow(
      "quantidade_pecas deve ser maior que zero"
    )
  })
})

describe("ratearFreteProporcional", () => {
  it("2 peças de custo 10,00 e 30,00 com frete 4,00 rateiam 1,00 e 3,00", () => {
    expect(ratearFreteProporcional([1000, 3000], 400)).toEqual([100, 300])
  })

  it("sem peças ou soma zerada é erro de validação", () => {
    expect(() => ratearFreteProporcional([], 400)).toThrow()
    expect(() => ratearFreteProporcional([0, 0], 400)).toThrow()
  })
})

describe("arredondarCusto", () => {
  it("nenhum: mantém valor normalizado ao centavo", () => {
    // 1976.2353... -> 1976.24 (centavo mais próximo)
    expect(arredondarCusto(1976.2353, "nenhum")).toBe(1976.24)
  })

  it("inteiro_mais_proximo: arredonda para o real inteiro próximo", () => {
    expect(arredondarCusto(1976, "inteiro_mais_proximo")).toBe(2000)
    expect(arredondarCusto(1949, "inteiro_mais_proximo")).toBe(1900)
  })

  it("inteiro_para_cima: 19,76 vira 20,00 (protege a margem)", () => {
    expect(arredondarCusto(1976.2353, "inteiro_para_cima")).toBe(2000)
    expect(arredondarCusto(2000, "inteiro_para_cima")).toBe(2000)
    expect(arredondarCusto(2000.01, "inteiro_para_cima")).toBe(2100)
  })

  it("multiplo_de_X: teto para o múltiplo (ex.: R$ 0,50)", () => {
    expect(arredondarCusto(1976.2353, "multiplo_de_X", 50)).toBe(2000)
    expect(arredondarCusto(1920, "multiplo_de_X", 50)).toBe(1950)
    expect(arredondarCusto(1900, "multiplo_de_X", 50)).toBe(1900)
  })
})

describe("cadeia completa da vendedora", () => {
  it("300,00 + 35,96 ÷ 17 peças, markup 100, termina_99 → 39,99", () => {
    const bruto = custoUnitarioBruto(30000, 3596, 17, "lote")
    const arredondado = arredondarCusto(bruto, "inteiro_para_cima")
    expect(arredondado).toBe(2000) // R$ 20,00, como na anotação dela
    const total = custoTotalUnitario(arredondado, 0, 0)
    const resultado = calcularPrecoSugerido(total, 100, "termina_99")
    expect(resultado.precoBrutoCentavos).toBe(4000)
    expect(resultado.precoSugeridoCentavos).toBe(3999)
    expect(resultado.lucroPorPecaCentavos).toBe(1999)
    expect(resultado.markupRealPercentual).toBeCloseTo(99.95, 2)
    expect(resultado.margemRealPercentual).toBeCloseTo(49.99, 2)
  })
})

describe("custoTotalUnitario", () => {
  it("soma custo arredondado + embalagem + extras", () => {
    const result = custoTotalUnitario(2000, 240, 0) // R$ 20,00 + R$ 2,40
    expect(result).toBe(2240) // R$ 22,40
  })

  it("embalagem zero não altera custo", () => {
    const result = custoTotalUnitario(2000, 0, 0)
    expect(result).toBe(2000)
  })
})

describe("calcularPrecoSugerido", () => {
  it("lote da vendedora: custo 2000 (R$ 20,00), markup 100, termina_99", () => {
    // custo total = 2000 centavos (R$ 20,00)
    // preço bruto = 2000 * 2 = 4000 centavos (R$ 40,00)
    // Math.ceil(40.00) = 40, 40 - 0.01 = 39.99 → 3999 centavos
    const resultado = calcularPrecoSugerido(2000, 100, "termina_99")
    expect(resultado.precoSugeridoCentavos).toBe(3999)
    expect(resultado.precoBrutoCentavos).toBe(4000)
  })

  it("mesmo lote, arredondamento 'nenhum' do custo, ainda assim termina_99 no preço", () => {
    // custo = 1976.24 centavos (R$ 19,76), sem arredondamento para real
    // preço bruto = 1976.24 * 2 = 3952.48 → 3952 centavos (R$ 39,52)
    // Math.ceil(39.52) = 40, 40 - 0.01 = 39.99 → 3999 centavos
    const resultado = calcularPrecoSugerido(1976.24, 100, "termina_99")
    expect(resultado.precoSugeridoCentavos).toBe(3999)
    expect(resultado.precoBrutoCentavos).toBe(3952)
  })

  it("com embalagem ilustrativa: custo 2240 (20.00 + 2.40), markup 100, termina_99", () => {
    // custo total = 2240 centavos (R$ 22,40)
    // preço bruto = 2240 * 2 = 4480 centavos (R$ 44,80)
    // Math.ceil(44.80) = 45, 45 - 0.01 = 44.99 → 4499 centavos
    const resultado = calcularPrecoSugerido(2240, 100, "termina_99")
    expect(resultado.precoSugeridoCentavos).toBe(4499)
    expect(resultado.precoBrutoCentavos).toBe(4480)
  })

  it("embalagem fora do markup: (20,00 × 2) + 2,40 = 42,40 → 42,99", () => {
    const resultado = calcularPrecoSugerido(2240, 100, "termina_99", {
      embalagemNoMarkup: true,
      custoPecaCentavos: 2000,
      embalagemExtrasCentavos: 240,
    })
    expect(resultado.precoBrutoCentavos).toBe(4240)
    expect(resultado.precoSugeridoCentavos).toBe(4299)
  })

  it("regra 'nenhum' no preço: sem transforma em .99", () => {
    // custo = 2000, markup 100, regra 'nenhum'
    // preço bruto = 4000, sugerido também = 4000 (sem ajuste .99)
    const resultado = calcularPrecoSugerido(2000, 100, "nenhum")
    expect(resultado.precoSugeridoCentavos).toBe(4000)
    expect(resultado.precoBrutoCentavos).toBe(4000)
  })

  it("regra termina_99: 40,00 / 40,01 / 44,80 → 39,99 / 40,99 / 44,99", () => {
    expect(calcularPrecoSugerido(4000, 0, "termina_99").precoSugeridoCentavos).toBe(3999)
    expect(calcularPrecoSugerido(4001, 0, "termina_99").precoSugeridoCentavos).toBe(4099)
    expect(calcularPrecoSugerido(4480, 0, "termina_99").precoSugeridoCentavos).toBe(4499)
  })
})

describe("metricasVenda", () => {
  it("custo 20,00 e preço 39,99: lucro 19,99, markup 99,95%, margem 49,99%", () => {
    const metrica = metricasVenda(3999, 2000, 0)
    expect(metrica.lucroPorPecaCentavos).toBe(1999)
    expect(metrica.markupRealPercentual).toBeCloseTo(99.95, 2)
    expect(metrica.margemRealPercentual).toBeCloseTo(49.99, 2)
  })

  it("lucro zerado quando preço = custo", () => {
    const metrica = metricasVenda(1976, 1976, 0)
    expect(metrica.lucroPorPecaCentavos).toBe(0)
    expect(metrica.markupRealPercentual).toBe(0)
    expect(metrica.margemRealPercentual).toBe(0)
  })

  it("taxa de pagamento reduz o lucro", () => {
    const metrica = metricasVenda(3999, 2000, 100) // R$ 1,00 taxa
    expect(metrica.lucroPorPecaCentavos).toBe(1899) // 3999 - 2000 - 100
    expect(metrica.markupRealPercentual).toBeLessThan(99.95)
  })
})

describe("verificarAlertaPrejuizo", () => {
  it("preço abaixo do custo dispara alerta", () => {
    const result = verificarAlertaPrejuizo(1999, 2240)
    expect(result.alert).toBe(true)
    expect(result.mensagem).toContain('prejuízo')
  })

  it("preço acima do custo não dispara alerta", () => {
    const result = verificarAlertaPrejuizo(3999, 2000)
    expect(result.alert).toBe(false)
    expect(result.mensagem).toBe('OK')
  })

  it("preço ligeiramente abaixo do custo também alerta", () => {
    // 5% abaixo do custo 2000 = 1900
    const result = verificarAlertaPrejuizo(1900, 2000)
    expect(result.alert).toBe(true)
  })
})

describe("alertaEmbalagemNaoConfigurada", () => {
  it("custo zero dispara alerta", () => {
    const result = alertaEmbalagemNaoConfigurada(0)
    expect(result.alert).toBe(true)
    expect(result.mensagem).toContain('não configurados')
  })

  it("custo positivo não dispara alerta", () => {
    const result = alertaEmbalagemNaoConfigurada(240)
    expect(result.alert).toBe(false)
    expect(result.mensagem).toBe('OK')
  })
})

describe("formatarReais", () => {
  it("formata corretamente em R$ com vírgula (Brasil)", () => {
    expect(formatarReais(3999)).toBe("R$ 39,99")
    expect(formatarReais(1050)).toBe("R$ 10,50")
    expect(formatarReais(0)).toBe("R$ 0,00")
    expect(formatarReais(-100)).toBe("-R$ 1,00")
  })
})