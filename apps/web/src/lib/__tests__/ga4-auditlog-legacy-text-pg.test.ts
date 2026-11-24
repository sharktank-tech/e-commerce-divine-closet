import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

// Apenas banco descartável do CI; nunca consultar o projeto Supabase real.
const disposable = process.env.GA4_CONCURRENCY_TEST_DB === "true" &&
  /^postgres(?:ql)?:\/\/[^/]+@(?:localhost|127\.0\.0\.1):5432\/divine_ga4_test(?:\?|$)/.test(
    process.env.DATABASE_URL ?? "",
  );
const inserted: string[] = [];
afterAll(async () => {
  if (!disposable || inserted.length === 0) return;
  await prisma.auditLog.deleteMany({ where: { id: { in: inserted } } });
});

describe.skipIf(!disposable)("AuditLog legado: schema-only TEXT no PostgreSQL descartável", () => {
  it("migrações mantêm AuditLog.id em TEXT sem recriar PK", async () => {
    const cols = await prisma.$queryRaw<Array<{ data_type: string; column_default: string | null }>>`
      SELECT data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'AuditLog' AND column_name = 'id'
    `;
    expect(cols).toHaveLength(1);
    expect(cols[0].data_type).toBe("text");
    expect(cols[0].column_default).toContain("gen_random_uuid");
  });

  it("Prisma cria e lê AuditLog usando default TEXT sem DDL", async () => {
    const row = await prisma.auditLog.create({
      data: {
        action: "ga4_test_schema_alignment",
        entity: "DisposableDatabaseOnly",
        entityId: randomUUID(),
        meta: { fixture: true },
      },
      select: { id: true, action: true },
    });
    inserted.push(row.id);
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action)
      .toBe("ga4_test_schema_alignment");
  });
});
