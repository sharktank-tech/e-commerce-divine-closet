// Normalização das colunas opcionais de custo do import CSV.
//
// Colunas aceitas (todas opcionais): lote_id (UUID), lote (nome),
// custo_peca (R$), markup (0–1000), custos_extras (R$).
// Ausentes → produto importa normalmente, sem snapshot (vai para a lista
// semCusto do relatório). Inválidas → erro de linha (não importa).

export type CustoCsv = {
  loteId: string | null;
  loteNome: string | null;
  custoPecaCentavos: number | null;
  markup: number | null;
  extrasCentavos: number;
};

const VAZIO: CustoCsv = {
  loteId: null,
  loteNome: null,
  custoPecaCentavos: null,
  markup: null,
  extrasCentavos: 0,
};

function parseReais(raw: string | undefined): number | null | "invalido" {
  const t = (raw || "").trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return "invalido";
  return Math.round(n * 100);
}

export function temOrigemCusto(c: CustoCsv): boolean {
  return !!(c.loteId || c.loteNome || c.custoPecaCentavos != null);
}

// Acumula o relatório pós-import sem duplicar o mesmo produto — mesmo que
// o chamador registre a linha mais de uma vez, cada nome aparece uma vez.
export function adicionarSemCusto(
  lista: string[],
  nome: string,
  temSnapshot: boolean
): string[] {
  if (!temSnapshot && !lista.includes(nome)) lista.push(nome);
  return lista;
}

export function normalizarCustoCsv(raw: {
  lote_id?: string;
  lote?: string;
  custo_peca?: string;
  markup?: string;
  custos_extras?: string;
}): { custo: CustoCsv; erro: string | null } {
  const loteId = (raw.lote_id || "").trim();
  if (loteId && !/^[0-9a-f-]{36}$/i.test(loteId)) {
    return { custo: VAZIO, erro: `lote_id inválido: "${loteId}"` };
  }

  const custoPeca = parseReais(raw.custo_peca);
  if (custoPeca === "invalido") {
    return { custo: VAZIO, erro: `custo_peca inválido: "${raw.custo_peca}"` };
  }

  const markupRaw = (raw.markup || "").trim();
  let markup: number | null = null;
  if (markupRaw) {
    const m = Number(markupRaw);
    if (!Number.isInteger(m) || m < 0 || m > 1000) {
      return { custo: VAZIO, erro: `markup inválido: "${raw.markup}" (0–1000)` };
    }
    markup = m;
  }

  const extras = parseReais(raw.custos_extras);
  if (extras === "invalido") {
    return { custo: VAZIO, erro: `custos_extras inválido: "${raw.custos_extras}"` };
  }

  return {
    custo: {
      loteId: loteId || null,
      loteNome: (raw.lote || "").trim() || null,
      custoPecaCentavos: custoPeca,
      markup,
      extrasCentavos: extras ?? 0,
    },
    erro: null,
  };
}
