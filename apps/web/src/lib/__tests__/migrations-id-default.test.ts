import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// Regressão do defeito de 17/10: migrations criaram Refund/OrderTrackToken/
// ErpEvent como TEXT sem DEFAULT, divergindo do schema
// (@db.Uuid @default(dbgenerated("gen_random_uuid()"))). O Prisma OMITE a
// coluna `id` no INSERT esperando o default do banco → violação NOT NULL
// (refund.create quebrava o estorno em produção com 500 antes de chegar ao
// Mercado Pago; orderTrackToken.create teria o mesmo efeito no link guest).
//
// O teste simula o estado final de cada coluna `id` a partir do histórico de
// migrations (CREATE + ALTERs posteriores) e exige UUID + DEFAULT — exceto
// as tabelas legadas listadas, criadas antes do padrão atual e já corrigidas
// diretamente no banco de produção (o histórico não é editável).

const PRISMA_DIR = join(__dirname, "..", "..", "..", "..", "..", "packages", "database", "prisma");
const MIGRATIONS_DIR = join(PRISMA_DIR, "migrations");

// Models com id TEXT no histórico de migrations (init/features anteriores ao
// padrão UUID+DEFAULT). Produção já os possui uuid+default (ajuste manual);
// quaisquer NOVAS tabelas devem seguir o padrão atual e não entrar aqui.
const LEGADO_TEXT_OK = new Set([
  "User",
  "Address",
  "Category",
  "Product",
  "ProductVariation",
  "WishlistItem",
  "Cart",
  "CartItem",
  "Order",
  "OrderItem",
  "Review",
  "Coupon",
  "Banner",
  "AuditLog",
  "Payment",
]);

type EstadoId = { tipo: "UUID" | "TEXT" | "AUSENTE"; temDefault: boolean };

function carregarMigrations(): string[] {
  const dirs = readdirSync(MIGRATIONS_DIR)
    .filter((d) => existsSync(join(MIGRATIONS_DIR, d, "migration.sql")))
    .sort();
  return dirs.map((d) => readFileSync(join(MIGRATIONS_DIR, d, "migration.sql"), "utf8"));
}

function modelsComIdDbgenerated(): Array<{ model: string; tabela: string }> {
  const schema = readFileSync(join(PRISMA_DIR, "schema.prisma"), "utf8");
  const modelos = [...schema.matchAll(/model (\w+) \{[\s\S]*?\n\}/g)];
  const out: Array<{ model: string; tabela: string }> = [];
  for (const m of modelos) {
    const bloco = m[0];
    // linha do id (ordem dos atributos varia: @id @db.Uuid @default, etc.)
    const linhaId = bloco.split("\n").find((l) => /^\s*id\s+String\s+@id\b/.test(l)) || "";
    if (!/@default\(dbgenerated\("gen_random_uuid\(\)"\)\)/.test(linhaId)) {
      continue;
    }
    const map = bloco.match(/@@map\("([^"]+)"\)/);
    out.push({ model: m[1], tabela: map ? map[1] : m[1] });
  }
  return out;
}

function estadoFinalId(sqlMigrations: string[], tabela: string): EstadoId {
  let estado: EstadoId = { tipo: "AUSENTE", temDefault: false };
  const esc = tabela.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const sql of sqlMigrations) {
    const cria = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?"${esc}"\\s*\\(([\\s\\S]*?)\\);`).exec(sql);
    if (cria) {
      const linhaId = cria[1].split("\n").find((l) => /^\s*"?id"?\s+/.test(l)) || "";
      const tipo = /^\s*"?id"?\s+UUID/i.test(linhaId)
        ? "UUID"
        : /^\s*"?id"?\s+TEXT/i.test(linhaId)
          ? "TEXT"
          : "AUSENTE";
      estado = {
        tipo,
        temDefault: /DEFAULT\s+gen_random_uuid\(\)/i.test(linhaId),
      };
    }
    const alterTipo = new RegExp(`ALTER TABLE "${esc}" ALTER COLUMN "?id"? TYPE (UUID|TEXT)`, "i").exec(sql);
    if (alterTipo) estado = { ...estado, tipo: alterTipo[1].toUpperCase() as EstadoId["tipo"] };
    if (new RegExp(`ALTER TABLE "${esc}" ALTER COLUMN "?id"? SET DEFAULT gen_random_uuid\\(\\)`, "i").test(sql)) {
      estado = { ...estado, temDefault: true };
    }
  }
  return estado;
}

describe("migrations: id das tabelas com dbgenerated no schema", () => {
  const sqlMigrations = carregarMigrations();
  const alvos = modelsComIdDbgenerated();

  it("encontra models com id dbgenerated no schema", () => {
    expect(alvos.length).toBeGreaterThan(10);
  });

  for (const { model, tabela } of alvos) {
    it(`${model} termina com id UUID DEFAULT gen_random_uuid() (ou esta na lista legada)`, () => {
      const estado = estadoFinalId(sqlMigrations, tabela);
      expect(
        estado.tipo,
        `${model}: tabela "${tabela}" não tem CREATE TABLE nas migrations`
      ).not.toBe("AUSENTE");

      if (estado.tipo === "TEXT") {
        expect(
          LEGADO_TEXT_OK.has(model),
          `${model}: migration cria id como TEXT ${estado.temDefault ? "com" : "SEM"} DEFAULT, ` +
            `mas o schema declara @db.Uuid @default(dbgenerated). Novas tabelas precisam de ` +
            `UUID NOT NULL DEFAULT gen_random_uuid() — sem o default o Prisma omite o id no ` +
            `INSERT e viola NOT NULL (ex.: refund.create do estorno).`
        ).toBe(true);
        return;
      }

      expect(
        estado.temDefault,
        `${model}: id UUID sem DEFAULT gen_random_uuid() — o Prisma omite o id no INSERT e ` +
          `viola NOT NULL (null constraint).`
      ).toBe(true);
    });
  }
});
