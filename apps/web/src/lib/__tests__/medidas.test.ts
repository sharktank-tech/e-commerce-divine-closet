import { describe, expect, it } from "vitest";
import { parseSizeTable, resolveSizeTable } from "../medidas";

const valid = {
  id: "1",
  name: "Feminino",
  unit: "cm",
  columns: [
    { key: "busto", label: "Busto" },
    { key: "cintura", label: "Cintura" },
  ],
  rows: [{ size: "P", values: { busto: "88", cintura: "68" } }],
  note: null,
};

describe("parseSizeTable", () => {
  it("aceita forma válida", () => {
    expect(parseSizeTable(valid)?.rows).toHaveLength(1);
  });

  it("rejeita formas inválidas", () => {
    expect(parseSizeTable(null)).toBeNull();
    expect(parseSizeTable({})).toBeNull();
    expect(parseSizeTable({ ...valid, columns: [{ key: "busto" }] })).toBeNull();
    expect(parseSizeTable({ ...valid, rows: [{ size: "P" }] })).toBeNull();
    expect(parseSizeTable({ ...valid, rows: [{ size: "P", values: { busto: 88 } }] })).toBeNull();
  });

  it("aplica unit padrão", () => {
    expect(parseSizeTable({ ...valid, unit: "" })?.unit).toBe("cm");
  });
});

describe("resolveSizeTable", () => {
  it("prioriza a tabela do produto", () => {
    const cat = { ...valid, id: "2", name: "Cat" };
    expect(resolveSizeTable(valid, cat)?.id).toBe("1");
  });

  it("usa a categoria como fallback", () => {
    expect(resolveSizeTable(null, valid)?.id).toBe("1");
    expect(resolveSizeTable({ lixo: true }, valid)?.id).toBe("1");
  });

  it("retorna null sem nenhuma válida", () => {
    expect(resolveSizeTable(null, null)).toBeNull();
  });
});
