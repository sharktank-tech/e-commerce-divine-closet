// Tabelas de medidas reutilizáveis (produto → categoria como fallback).

export type SizeColumn = { key: string; label: string };
export type SizeRow = { size: string; values: Record<string, string> };
export type SizeTableData = {
  id: string;
  name: string;
  unit: string;
  columns: SizeColumn[];
  rows: SizeRow[];
  note?: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** valida o JSON vindo do banco; null se a forma for inválida */
export function parseSizeTable(raw: unknown): SizeTableData | null {
  if (!isRecord(raw)) return null;
  const { id, name, unit, columns, rows, note } = raw;
  if (typeof id !== "string" || typeof name !== "string") return null;
  if (!Array.isArray(columns) || !columns.every((c) => isRecord(c) && typeof c.key === "string" && typeof c.label === "string"))
    return null;
  if (
    !Array.isArray(rows) ||
    !rows.every(
      (r) =>
        isRecord(r) &&
        typeof r.size === "string" &&
        isRecord(r.values) &&
        Object.values(r.values).every((v) => typeof v === "string")
    )
  )
    return null;
  return {
    id,
    name,
    unit: typeof unit === "string" && unit ? unit : "cm",
    columns: columns as SizeColumn[],
    rows: rows as SizeRow[],
    note: typeof note === "string" ? note : null,
  };
}

/** produto primeiro, categoria como fallback */
export function resolveSizeTable(
  productTable: unknown,
  categoryTable?: unknown | null
): SizeTableData | null {
  return parseSizeTable(productTable) ?? parseSizeTable(categoryTable);
}
