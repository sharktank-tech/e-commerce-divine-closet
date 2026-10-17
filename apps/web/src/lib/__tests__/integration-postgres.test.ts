import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// Integração com PostgreSQL REAL (PGlite = PostgreSQL compilado, servido por
// socket TCP) cobrindo o caminho de criação que falhou em produção:
// refund.create/orderTrackToken.create SEM id, que dependem do DEFAULT do
// banco (schema @default(dbgenerated)) — mocks não provam o schema.
//
// Sequência: aplica o SQL versionado DEFETUOSO real (as3 migrations de
// 17/10, id TEXT sem DEFAULT), reproduz a violação NOT NULL (o500 do
// estorno), aplica 20261017200000_ids_uuid_default e reexecuta com sucesso.
// Um segundo grupo roda `prisma migrate deploy` em banco vazio e fixa a
// divergência pré-existente do histórico (ver DRIFT-BANCO-2026-10-17.md).

const run = promisify(execFile);
const PRISMA_DIR = resolve(__dirname, "..", "..", "..", "..", "..", "packages", "database", "prisma");
const MIGRATIONS = join(PRISMA_DIR, "migrations");

function sqlDe(nome: string): string {
  return readFileSync(join(MIGRATIONS, nome, "migration.sql"), "utf8");
}

type Ambiente = {
  db: PGlite;
  server: PGLiteSocketServer;
  url: string;
  dir: string;
};

async function abrirPostgres(prefixo: string): Promise<Ambiente> {
  const dir = mkdtempSync(join(tmpdir(), `${prefixo}-`));
  const db = await PGlite.create({ dataDir: dir });
  let port = 56000 + Math.floor(Math.random() * 8000);
  let server: PGLiteSocketServer | null = null;
  for (let tentativa = 0; tentativa < 10 && !server; tentativa++) {
    try {
      const candidato = new PGLiteSocketServer({ db, port, maxConnections: 50 });
      await candidato.start();
      server = candidato;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
      port = 56000 + Math.floor(Math.random() * 8000);
    }
  }
  if (!server) throw new Error("sem porta livre para o PGlite");
  // connection_limit=1: o PGlite multiplexa sessões, mas o pool do Prisma com
  // várias conexões derruba o socket (P1017). Uma conexão é suficiente aqui.
  return {
    db,
    server,
    url: `postgresql://postgres@127.0.0.1:${port}/postgres?schema=public&connection_limit=1`,
    dir,
  };
}

async function fechar(amb: Ambiente | null): Promise<void> {
  if (!amb) return;
  await amb.server.stop();
  await amb.db.close();
  rmSync(amb.dir, { recursive: true, force: true });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("integração PostgreSQL real — caminho refund/token (defeito 17/10)", () => {
  let amb: Ambiente | null = null;
  let prisma: PrismaClient | null = null;
  let orderId: string;

  beforeAll(async () => {
    amb = await abrirPostgres("pg-it-refund");
    // Order mínimo só com id (uuid, como produção) — alvo de FK.
    await amb.db.exec(
      `CREATE TABLE "Order" ("id" UUID NOT NULL DEFAULT gen_random_uuid(), CONSTRAINT "Order_pkey" PRIMARY KEY ("id"));` +
        `INSERT INTO "Order" ("id") VALUES (gen_random_uuid());`
    );
    // SQL versionado real, como estava antes do fix (id TEXT sem DEFAULT).
    await amb.db.exec(sqlDe("20261017170000_refund"));
    await amb.db.exec(sqlDe("20261017180000_order_track_token"));
    await amb.db.exec(sqlDe("20261017190000_erp_event"));
    const o = await amb.db.query<{ id: string }>(`SELECT "id" FROM "Order" LIMIT 1`);
    orderId = o.rows[0].id;
    prisma = new PrismaClient({ datasourceUrl: amb.url });
    await prisma.$connect();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await fechar(amb);
    amb = null;
  }, 60_000);

  async function reconectar(): Promise<void> {
    await prisma!.$disconnect();
    prisma = new PrismaClient({ datasourceUrl: amb!.url });
    await prisma.$connect();
  }

  it("SEM a fix: refund.create e orderTrackToken.create violam NOT NULL (reproduz o500)", async () => {
    await expect(
      prisma!.refund.create({
        data: { orderId, paymentId: "184666023462", amount: 32.99, idempotencyKey: "it-1" },
      })
    ).rejects.toMatchObject({ code: "P2011" });
    // o erro de constraint derruba a sessão socket do PGlite (P1017) — nova
    // conexão para o segundo caso (mesma realidade: cada request de produção
    // é uma conexão nova do pool).
    await reconectar();
    await expect(
      prisma!.orderTrackToken.create({
        data: { orderId, tokenHash: "hash-it-1", expiresAt: new Date(Date.now() + 3600_000) },
      })
    ).rejects.toMatchObject({ code: "P2011" });
  }, 60_000);

  it("aplica 20261017200000_ids_uuid_default (conteúdo versionado real)", async () => {
    // Reconecta o cliente: o DDL direto no PGlite invalida a sessão socket
    // aberta do Prisma (P1017), então troca de cliente antes do pós-fix.
    await prisma!.$disconnect();
    await amb!.db.exec(sqlDe("20261017200000_ids_uuid_default"));
    prisma = new PrismaClient({ datasourceUrl: amb!.url });
    await prisma.$connect();
  }, 60_000);

  it("COM a fix: refund.create sem id grava id uuid gerado pelo banco", async () => {
    const r = await prisma!.refund.create({
      data: { orderId, paymentId: "184666023462", amount: 32.99, idempotencyKey: "it-2" },
      select: { id: true, status: true },
    });
    expect(r.id).toMatch(UUID_RE);
    expect(r.status).toBe("REQUESTED");
  });

  it("COM a fix: orderTrackToken.create sem id grava id uuid gerado pelo banco", async () => {
    const t = await prisma!.orderTrackToken.create({
      data: { orderId, tokenHash: "hash-it-2", expiresAt: new Date(Date.now() + 3600_000) },
      select: { id: true },
    });
    expect(t.id).toMatch(UUID_RE);
  });

  it("estrutura final: uuid + DEFAULT gen_random_uuid() nas3 tabelas", async () => {
    const rows = await amb!.db.query<{ table_name: string; data_type: string; column_default: string }>(
      `SELECT table_name, data_type, column_default FROM information_schema.columns
       WHERE column_name = 'id' AND table_name IN ('Refund','OrderTrackToken','ErpEvent')
       ORDER BY table_name`
    );
    expect(rows.rows.map((r) => r.table_name)).toEqual(["ErpEvent", "OrderTrackToken", "Refund"]);
    for (const r of rows.rows) {
      expect(r.data_type, `${r.table_name}.id type`).toBe("uuid");
      expect(r.column_default, `${r.table_name}.id default`).toContain("gen_random_uuid()");
    }
  });

  it("erpEvent.create informando o id (caminho da aplicação) persiste", async () => {
    const e = await prisma!.erpEvent.create({
      data: { id: crypto.randomUUID(), tipo: "pedido_estornado", payload: { numero: "DC-IT" } },
      select: { id: true, status: true },
    });
    expect(e.status).toBe("PENDING");
  });
});

describe("integração PostgreSQL real — prisma migrate deploy em banco novo", () => {
  let amb: Ambiente | null = null;

  afterAll(async () => {
    await fechar(amb);
    amb = null;
  }, 60_000);

  it(
    "histórico atual NÃO reconstitui produção: falha em reviews com 42804 (divergência pré-existente)",
    async () => {
      amb = await abrirPostgres("pg-it-deploy");
      // Fixa a realidade: id de Order é TEXT no init e nada no histórico o
      // converte para uuid (produção converteu fora do histórico), então a
      // FK uuid→text de Review aborta o deploy. Se alguém corrigir o
      // histórico (reescrita aprovada), este teste falha e o doc deve ser
      // atualizado junto.
      let stdout = "";
      let stderr = "";
      let codigo = 0;
      try {
        const res = await run(
          "npx",
          ["prisma", "migrate", "deploy", "--schema", join(PRISMA_DIR, "schema.prisma")],
          { env: { ...process.env, DATABASE_URL: amb.url }, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 }
        );
        stdout = res.stdout;
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        codigo = typeof e.code === "number" ? e.code : 1;
        stdout = e.stdout ?? "";
        stderr = e.stderr ?? "";
      }
      const tudo = `${stdout}\n${stderr}`;
      expect(codigo, "deploy em banco novo deveria falhar hoje").not.toBe(0);
      expect(tudo).toContain("20260928181651_reviews");
      expect(tudo).toContain("42804");
    },
    240_000
  );
});
