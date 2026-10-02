import { describe, expect, it } from "vitest";
import { normalizarCustoCsv, temOrigemCusto } from "@/lib/import-csv";

describe("normalizarCustoCsv", () => {
  it("tudo vazio: sem origem, sem erro", () => {
    const { custo, erro } = normalizarCustoCsv({});
    expect(erro).toBeNull();
    expect(temOrigemCusto(custo)).toBe(false);
  });

  it("conjunto completo válido (vírgula decimal, nome de lote)", () => {
    const { custo, erro } = normalizarCustoCsv({
      lote: "Coleção Verão",
      custo_peca: "45,90",
      markup: "120",
      custos_extras: "2,50",
    });
    expect(erro).toBeNull();
    expect(custo).toMatchObject({
      loteId: null,
      loteNome: "Coleção Verão",
      custoPecaCentavos: 4590,
      markup: 120,
      extrasCentavos: 250,
    });
    expect(temOrigemCusto(custo)).toBe(true);
  });

  it("lote_id UUID válido é origem", () => {
    const { custo, erro } = normalizarCustoCsv({
      lote_id: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(erro).toBeNull();
    expect(custo.loteId).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(temOrigemCusto(custo)).toBe(true);
  });

  it("lote_id fora do formato UUID: erro", () => {
    const { erro } = normalizarCustoCsv({ lote_id: "lote-1" });
    expect(erro).toMatch(/lote_id inválido/);
  });

  it("custo_peca negativo ou texto: erro", () => {
    expect(normalizarCustoCsv({ custo_peca: "-5" }).erro).toMatch(/custo_peca inválido/);
    expect(normalizarCustoCsv({ custo_peca: "abc" }).erro).toMatch(/custo_peca inválido/);
  });

  it("markup fora de 0–1000 ou não-inteiro: erro", () => {
    expect(normalizarCustoCsv({ markup: "1001" }).erro).toMatch(/markup inválido/);
    expect(normalizarCustoCsv({ markup: "12.5" }).erro).toMatch(/markup inválido/);
    expect(normalizarCustoCsv({ markup: "0" }).erro).toBeNull();
  });

  it("só custos_extras não é origem de custo", () => {
    const { custo, erro } = normalizarCustoCsv({ custos_extras: "3" });
    expect(erro).toBeNull();
    expect(custo.extrasCentavos).toBe(300);
    expect(temOrigemCusto(custo)).toBe(false);
  });
});
