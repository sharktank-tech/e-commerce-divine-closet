import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
// Um segundo grupo roda `prisma migrate deploy` em banco vazio e exige o
// replay COMPLETO do histórico (reconstrução do zero), incluindo a migração
// de compatibilidade 20260928181000_rebuild_legacy_uuid que versiona as
// conversões id TEXT→uuid antes feitas fora do histórico (ver
// DRIFT-BANCO-2026-10-17.md).

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
        data: { orderId, paymentId: "p2", amount: 32.99, idempotencyKey: "it-1" },
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
      data: { orderId, paymentId: "p2", amount: 32.99, idempotencyKey: "it-2" },
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
  let saida = "";

  beforeAll(async () => {
    amb = await abrirPostgres("pg-it-deploy");
    // Procedimento de implantação real (npm run prisma:deploy). Antes de
    // 20260928181000_rebuild_legacy_uuid este replay falhava em reviews com
    // 42804 (FK uuid→text): as conversões id TEXT→uuid do ciclo 25–28/09
    // aconteceram fora do histórico. A migração de compatibilidade versiona
    // essa conversão sem reescrever nada já aplicado.
    const res = await run(
      "npx",
      ["prisma", "migrate", "deploy", "--schema", join(PRISMA_DIR, "schema.prisma")],
      { env: { ...process.env, DATABASE_URL: amb.url }, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 }
    );
    saida = res.stdout;
  }, 240_000);

  afterAll(async () => {
    await fechar(amb);
    amb = null;
  }, 60_000);

  it("aplica o histórico inteiro em banco vazio, sem db push nem SQL manual", () => {
    const aplicadas = [...saida.matchAll(/Applying migration `([^`]+)`/g)].map((m) => m[1]);
    const total = readdirSync(MIGRATIONS).filter((d) => existsSync(join(MIGRATIONS, d, "migration.sql"))).length;
    expect(aplicadas.length).toBe(total);
    expect(saida).toContain("All migrations have been successfully applied.");
  });

  it("tabelas legadas terminam com id uuid DEFAULT gen_random_uuid()", async () => {
    const rows = await amb!.db.query<{ table_name: string; data_type: string; column_default: string | null }>(
      `SELECT table_name, data_type, column_default FROM information_schema.columns
        WHERE column_name='id' AND table_schema='public'
          AND table_name IN ('User','Address','Category','Product','ProductVariation','WishlistItem',
                             'Cart','CartItem','Order','OrderItem','Review','Coupon','Banner')`
    );
    expect(rows.rows.length).toBe(13);
    for (const r of rows.rows) {
      expect(r.data_type, `${r.table_name}.id type`).toBe("uuid");
      expect(r.column_default, `${r.table_name}.id default`).toContain("gen_random_uuid()");
    }
  });

  it("FKs recriadas após a conversão continuam íntegras", async () => {
    const rows = await amb!.db.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c
        JOIN pg_class t ON t.oid=c.conrelid
       WHERE c.contype='f' AND t.relnamespace='public'::regnamespace
         AND c.conname IN ('Review_orderId_fkey','Review_userId_fkey','OrderItem_orderId_fkey',
                           'CartItem_productId_fkey','Product_categoryId_fkey','Category_parentId_fkey')`
    );
    expect(rows.rows.map((r) => r.conname).sort()).toEqual([
      "CartItem_productId_fkey",
      "Category_parentId_fkey",
      "OrderItem_orderId_fkey",
      "Product_categoryId_fkey",
      "Review_orderId_fkey",
      "Review_userId_fkey",
    ]);
  });

  it("roles anon/authenticated existem (exigidos pelas policies de reviews)", async () => {
    const rows = await amb!.db.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','divine_app')`
    );
    expect(rows.rows.map((r) => r.rolname).sort()).toEqual(["anon", "authenticated", "divine_app"]);
  });

  it("Refund/OrderTrackToken/ErpEvent: uuid + DEFAULT + unicidades + FK", async () => {
    // EmailOutbox (20261017210000) e businessKey (20261017220000) só existem
    // no histórico quando os PRs #10/#11 entram; as asserções seguem o que o
    // deploy realmente aplicou (no combinado, todas rodam).
    const temOutbox = saida.includes("20261017210000_email_outbox");
    const temBusinessKey = saida.includes("20261017220000_erp_event_business_key");
    const lista = temOutbox
      ? "'Refund','OrderTrackToken','ErpEvent','EmailOutbox'"
      : "'Refund','OrderTrackToken','ErpEvent'";
    const cols = await amb!.db.query<{ table_name: string; data_type: string; column_default: string | null }>(
      `SELECT table_name, data_type, column_default FROM information_schema.columns
        WHERE column_name='id' AND table_schema='public' AND table_name IN (${lista})`
    );
    expect(cols.rows.length).toBe(temOutbox ? 4 : 3);
    for (const r of cols.rows) {
      expect(r.data_type, `${r.table_name}.id type`).toBe("uuid");
      expect(r.column_default, `${r.table_name}.id default`).toContain("gen_random_uuid()");
    }
    const uniques = await amb!.db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexdef LIKE '%UNIQUE%'
         AND tablename IN (${lista})`
    );
    const esperados = [
      "Refund_orderId_key",
      "Refund_idempotencyKey_key",
      "OrderTrackToken_orderId_key",
      "OrderTrackToken_tokenHash_key",
    ];
    if (temBusinessKey) esperados.push("ErpEvent_businessKey_key");
    if (temOutbox) esperados.push("EmailOutbox_dedupeKey_key");
    expect(uniques.rows.map((r) => r.indexname).sort()).toEqual(expect.arrayContaining(esperados));
    const fks = await amb!.db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE contype='f' AND conname IN ('Refund_orderId_fkey','OrderTrackToken_orderId_fkey')`
    );
    expect(fks.rows.map((r) => r.conname).sort()).toEqual(["OrderTrackToken_orderId_fkey", "Refund_orderId_fkey"]);
  });
});
