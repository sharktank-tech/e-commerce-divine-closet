import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

// Apenas PostgreSQL local DESCARTÁVEL do GitHub Actions; sem acesso à produção.
const disposable = process.env.GA4_CONCURRENCY_TEST_DB === "true" &&
  /^postgres(?:ql)?:\/\/[^/]+@(?:localhost|127\.0\.0\.1):5432\/divine_ga4_test(?:\?|$)/.test(
    process.env.DATABASE_URL ?? "",
  );

type TimestampColumn = {
  table_name: string;
  column_name: string;
  data_type: string;
  column_default: string | null;
};

describe.skipIf(!disposable)("Drift legado: timestamps de precificação no PostgreSQL descartável", () => {
  it("colunas criadas pelo histórico são TIMESTAMPTZ e possuem default now()", async () => {
    const columns = await prisma.$queryRaw<TimestampColumn[]>`
      SELECT table_name, column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('config_precificacao', 'materiais_embalagem')
        AND column_name IN ('created_at', 'updated_at')
      ORDER BY table_name, column_name
    `;
    expect(columns).toHaveLength(4);
    const keys = columns.map((c) => c.table_name + "." + c.column_name);
    expect(keys).toEqual([
      "config_precificacao.created_at",
      "config_precificacao.updated_at",
      "materiais_embalagem.created_at",
      "materiais_embalagem.updated_at",
    ]);
    for (const column of columns) {
      expect(column.data_type).toBe("timestamp with time zone");
      expect(column.column_default).toMatch(/now\(\)|CURRENT_TIMESTAMP/i);
    }
  });

  it("Prisma Client lê as datas sem alterar dados de precificação", async () => {
    const config = await prisma.configPrecificacao.findFirst({
      select: { id: true, created_at: true, updated_at: true },
    });
    const material = await prisma.materiaisEmbalagem.findFirst({
      select: { id: true, created_at: true, updated_at: true },
    });
    expect(config).not.toBeNull();
    expect(config?.created_at).toBeInstanceOf(Date);
    expect(config?.updated_at).toBeInstanceOf(Date);
    expect(material).not.toBeNull();
    expect(material?.created_at).toBeInstanceOf(Date);
    expect(material?.updated_at).toBeInstanceOf(Date);
    for (const timestamp of [
      config?.created_at, config?.updated_at,
      material?.created_at, material?.updated_at,
    ]) expect(Number.isFinite(timestamp?.getTime())).toBe(true);
  });
});
