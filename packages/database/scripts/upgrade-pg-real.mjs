// Reconstrução (banco vazio) e upgrade (base sintética prodlike/legacy) em
// PostgreSQL REAL — substitui a versão PGlite, que multiplexava todas as
// conexões numa única sessão backend e exigia reabrir o socket entre fases.
// Uso:
//   node packages/database/scripts/upgrade-pg-real.mjs rebuild   # do zero
//   node packages/database/scripts/upgrade-pg-real.mjs prodlike  # upgrade
//   node packages/database/scripts/upgrade-pg-real.mjs legacy    # upgrade
//
// Pré-requisitos: PostgreSQL real acessível (PGHOST/PGPORT/PGUSER ou
// defaults 127.0.0.1:5433 postgres). Bancos dc_pgreal_* são descartáveis e
// recriados a cada execução. Nenhum toque em produção.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PRISMA = resolve(__dirname, "..", "prisma");
const REPO = resolve(__dirname, "..", "..", "..");
const require = createRequire(join(REPO, "package.json"));
const { PrismaClient } = require("@prisma/client");

const modo = process.argv[2] || "rebuild";
const PGHOST = process.env.PGHOST || "127.0.0.1";
const PGPORT = process.env.PGPORT || "5433";
const PGUSER = process.env.PGUSER || "postgres";
const NOME_DB = `dc_pgreal_${modo}`;
const URL = `postgresql://${PGUSER}@${PGHOST}:${PGPORT}/${NOME_DB}`;

const psql = async (sql, db = "postgres") =>
  run("psql", ["-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", db, "-v", "ON_ERROR_STOP=1", "-c", sql]);

async function criarBanco() {
  await psql(`DROP DATABASE IF EXISTS ${NOME_DB};`);
  await psql(`CREATE DATABASE ${NOME_DB};`);
}

const deploy = async (schemaDir) => {
  const { stdout } = await run("npx", ["prisma", "migrate", "deploy", "--schema", join(schemaDir, "schema.prisma")], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: URL },
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
};

// ---------- base para upgrade: migrations truncadas ----------
function copiarMigrationsBase(destino, filtros) {
  cpSync(PRISMA, destino, { recursive: true });
  for (const d of readdirSync(join(destino, "migrations"))) {
    if (!d.startsWith("2026")) continue;
    if (filtros(d)) rmSync(join(destino, "migrations", d), { recursive: true, force: true });
  }
}

async function prepararBaseUpgrade() {
  const corte = modo === "legacy" ? "20260928180013" : "20261017200000";
  const ehNovaRebuild = (d) => d === "20260928181000_rebuild_legacy_uuid";
  if (modo === "legacy") {
    const dir = join(REPO, ".tmp-upgrade-legacy");
    rmSync(dir, { recursive: true, force: true });
    copiarMigrationsBase(dir, (d) => d > corte || ehNovaRebuild(d));
    // aplica o histórico truncado (estado legado: ids ainda TEXT)
    await deploy(dir);
    return PRISMA; // deploy final usa o histórico completo do repo
  }
  // prodlike: deploy até 20260928180013, conversão uuid FORA do ledger
  // (emula db push de produção), deploy de 20260928181651..20261017200000.
  const dirA = join(REPO, ".tmp-upgrade-a");
  rmSync(dirA, { recursive: true, force: true });
  copiarMigrationsBase(dirA, (d) => d > "20260928180013" || ehNovaRebuild(d));
  await deploy(dirA);
  const sqlRebuild = readFileSync(
    join(PRISMA, "migrations", "20260928181000_rebuild_legacy_uuid", "migration.sql"),
    "utf8"
  );
  await psql(sqlRebuild, NOME_DB);
  const dirB = join(REPO, ".tmp-upgrade-b");
  rmSync(dirB, { recursive: true, force: true });
  copiarMigrationsBase(dirB, (d) => d > corte || ehNovaRebuild(d));
  // 20261017200000_ids_uuid_default veio do PR #9 — inclui para o deploy
  // "pendente" a enxergar como migração nova.
  const dir200000 = join(dirB, "migrations", "20261017200000_ids_uuid_default");
  mkdirSync(dir200000, { recursive: true });
  try {
    const { stdout } = await run(
      "git",
      ["show", "origin/fix/migrations-id-default:packages/database/prisma/migrations/20261017200000_ids_uuid_default/migration.sql"],
      { cwd: REPO, encoding: "utf8" }
    );
    writeFileSync(join(dir200000, "migration.sql"), stdout);
  } catch {
    writeFileSync(join(dir200000, "migration.sql"), readFileSync(join(PRISMA, "migrations", "20261017200000_ids_uuid_default", "migration.sql"), "utf8"));
  }
  await deploy(dirB);
  return PRISMA; // deploy final usa o histórico completo do repo
}

// ---------- seed de dados preexistentes ----------
async function seed(prisma, modo2) {
  const um = async (sql) => (await prisma.$queryRawUnsafe(sql))[0];
  const ins = async (sql) => prisma.$executeRawUnsafe(sql);
  const ids = {
    user: "11111111-1111-4111-8111-111111111111",
    user2: "22222222-2222-4222-8222-222222222222",
    addr: "33333333-3333-4333-8333-333333333333",
    cat: "44444444-4444-4444-8444-444444444444",
    prod: "55555555-5555-4555-8555-555555555555",
    order: "66666666-6666-4666-8666-666666666666",
    order2: "77777777-7777-4777-8777-777777777777",
    item: "88888888-8888-4888-8888-888888888888",
    cart: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    itemCart: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  };
  const temTabela = async (n) =>
    (await um(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name='${n}'`)).n === 1;
  const temColuna = async (t, c) =>
    (await um(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}' AND column_name='${c}'`)).n === 1;
  if (modo2 === "rebuild") return ids; // rebuild sem seed prévio (banco vazio)
  await ins(`INSERT INTO "User" (id,email,password,name,role,"createdAt","updatedAt") VALUES
    ('${ids.user}','upgrade-a@example.com','x','Upgrade A','CLIENT',NOW(),NOW()),
    ('${ids.user2}','upgrade-b@example.com','x','Upgrade B','ADMIN',NOW(),NOW())`);
  await ins(`INSERT INTO "Address" (id,"userId",label,street,number,neighborhood,city,state,"zipCode","createdAt","updatedAt") VALUES
    ('${ids.addr}','${ids.user}','Principal','Rua A','10','Centro','Araguaina','TO','00000-000',NOW(),NOW())`);
  await ins(`INSERT INTO "Category" (id,name,slug,status,"createdAt","updatedAt") VALUES
    ('${ids.cat}','Vestidos','vestidos','ACTIVE',NOW(),NOW())`);
  await ins(`INSERT INTO "Product" (id,name,slug,description,price,"categoryId",stock,"createdAt","updatedAt") VALUES
    ('${ids.prod}','Vestido Longo','vestido-longo','Vestido de festa longo',199.90,'${ids.cat}',5,NOW(),NOW())`);
  await ins(`INSERT INTO "Order" (id,number,"userId","addressId",status,"paymentStatus",subtotal,shipping,discount,total,"createdAt","updatedAt") VALUES
    ('${ids.order}','DC-UP-1','${ids.user}','${ids.addr}','PAID','PAID',199.90,20,0,219.90,NOW(),NOW()),
    ('${ids.order2}','DC-UP-2','${ids.user}','${ids.addr}','PAID','PAID',199.90,20,0,219.90,NOW(),NOW())`);
  await ins(`INSERT INTO "OrderItem" (id,"orderId","productId","productName","productSlug",quantity,"unitPrice",total) VALUES
    ('${ids.item}','${ids.order}','${ids.prod}','Vestido Longo','vestido-longo',1,199.90,199.90)`);
  if (modo2 !== "legacy") {
    if (await temColuna("Review", "orderId")) {
      await ins(`INSERT INTO "Review" (id,"userId","productId","orderId",rating,comment,status,"createdAt","updatedAt") VALUES
        ('11111111-1111-4111-8111-111111111112','${ids.user}','${ids.prod}','${ids.order}',5,'Ótimo','APROVADA',NOW(),NOW())`);
    } else {
      await ins(`INSERT INTO "Review" (id,"userId","productId",rating,comment,"createdAt","updatedAt") VALUES
        ('11111111-1111-4111-8111-111111111112','${ids.user}','${ids.prod}',5,'Ótimo',NOW(),NOW())`);
    }
  }
  await ins(`INSERT INTO "Cart" (id,"userId","updatedAt") VALUES ('${ids.cart}','${ids.user}',NOW())`);
  if (await temColuna("CartItem", "unitPrice")) {
    await ins(`INSERT INTO "CartItem" (id,"cartId","productId",quantity,"unitPrice","createdAt") VALUES
      ('${ids.itemCart}','${ids.cart}','${ids.prod}',1,199.90,NOW())`);
  } else {
    await ins(`INSERT INTO "CartItem" (id,"cartId","productId",quantity) VALUES
      ('${ids.itemCart}','${ids.cart}','${ids.prod}',1)`);
  }
  if (modo2 === "prodlike") {
    await ins(`INSERT INTO "Refund" (id,"orderId","paymentId",amount,status,"idempotencyKey","updatedAt") VALUES
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','${ids.order}','184666023462',219.90,'APPROVED','up-7653',NOW())`);
    await ins(`INSERT INTO "OrderTrackToken" (id,"orderId","tokenHash","expiresAt","updatedAt") VALUES
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','${ids.order}','hash-up-1', NOW() + interval '1 day',NOW())`);
    await ins(`INSERT INTO "ErpEvent" (id,version,tipo,payload,status,"updatedAt") VALUES
      ('ffffffff-ffff-4fff-8fff-ffffffffffff',1,'pedido_estornado','{"numero":"DC-UP-1"}'::jsonb,'DEAD',NOW()),
      ('10101010-1010-4101-8101-101010101010',1,'pedido_estornado','{"numero":"DC-UP-1"}'::jsonb,'DELIVERED',NOW())`);
  } else if (await temTabela("ErpEvent")) {
    await ins(`INSERT INTO "ErpEvent" (id,version,tipo,payload,status,"updatedAt") VALUES
      ('ffffffff-ffff-4fff-8fff-ffffffffffff',1,'pedido_estornado','{"numero":"DC-UP-1"}'::jsonb,'PENDING',NOW())`);
  }
  return ids;
}

// ---------- verificação pós-deploy ----------
async function verificar(prisma, modo2, ids, aplicadas) {
  const um = async (sql) => (await prisma.$queryRawUnsafe(sql))[0];
  const temTabela = async (n) =>
    (await um(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name='${n}'`)).n === 1;
  const relatorio = { modo: modo2, aplicadas };
  relatorio.contagens = {
    users: (await um(`SELECT count(*)::int n FROM "User"`)).n,
    orders: (await um(`SELECT count(*)::int n FROM "Order"`)).n,
    orderItems: (await um(`SELECT count(*)::int n FROM "OrderItem"`)).n,
    reviews: (await um(`SELECT count(*)::int n FROM "Review"`)).n,
    cartItems: (await um(`SELECT count(*)::int n FROM "CartItem"`)).n,
    refunds: (await temTabela("Refund")) ? (await um(`SELECT count(*)::int n FROM "Refund"`)).n : null,
    trackTokens: (await temTabela("OrderTrackToken")) ? (await um(`SELECT count(*)::int n FROM "OrderTrackToken"`)).n : null,
    erpEvents: (await temTabela("ErpEvent")) ? (await um(`SELECT count(*)::int n FROM "ErpEvent"`)).n : null,
    emailOutbox: (await temTabela("EmailOutbox")) ? (await um(`SELECT count(*)::int n FROM "EmailOutbox"`)).n : null,
    rateLimit: (await temTabela("RateLimit")) ? (await um(`SELECT count(*)::int n FROM "RateLimit"`)).n : null,
  };
  if (modo2 !== "rebuild") {
    relatorio.dadosPreservados =
      relatorio.contagens.users === 2 &&
      relatorio.contagens.orders === 2 &&
      relatorio.contagens.reviews === (modo2 === "legacy" ? 0 : 1) &&
      relatorio.contagens.cartItems === 1 &&
      relatorio.contagens.orderItems === 1;
  }
  relatorio.tabelasNovas = {
    emailOutbox: await temTabela("EmailOutbox"),
    rateLimit: await temTabela("RateLimit"),
    businessKey:
      (await um(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='ErpEvent' AND column_name='businessKey'`)).n === 1,
    uniqueBusinessKey:
      (await um(`SELECT count(*)::int n FROM pg_indexes WHERE schemaname='public' AND indexname='ErpEvent_businessKey_key'`)).n === 1,
    uniqueDedupeKey:
      (await um(`SELECT count(*)::int n FROM pg_indexes WHERE schemaname='public' AND indexname='EmailOutbox_dedupeKey_key'`)).n === 1,
  };
  relatorio.tiposId = (
    await prisma.$queryRawUnsafe(`
      SELECT table_name, data_type, column_default IS NOT NULL AS tem_default
        FROM information_schema.columns
       WHERE table_schema='public' AND column_name='id'
         AND table_name IN ('User','Order','OrderItem','Review','Refund','OrderTrackToken','ErpEvent','CartItem','EmailOutbox','RateLimit','AuditLog')
       ORDER BY 1`)
  ).map((r) => `${r.table_name}.id ${r.data_type}${r.tem_default ? " DEFAULT" : ""}`);
  relatorio.unicidades = (
    await prisma.$queryRawUnsafe(`
      SELECT tablename, indexname FROM pg_indexes
       WHERE schemaname='public' AND indexdef LIKE '%UNIQUE%'
         AND tablename IN ('Refund','OrderTrackToken','ErpEvent','EmailOutbox','Review')
       ORDER BY 1,2`)
  ).map((r) => `${r.tablename}.${r.indexname}`);
  relatorio.fks = (
    await prisma.$queryRawUnsafe(`
      SELECT t.relname origem, tf.relname alvo, c.conname nome FROM pg_constraint c
        JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class tf ON tf.oid=c.confrelid
       WHERE c.contype='f' AND t.relnamespace='public'::regnamespace
         AND t.relname IN ('Refund','OrderTrackToken','Review','OrderItem','CartItem')
       ORDER BY 1,3`)
  ).map((r) => `${r.origem}.${r.nome} -> ${r.alvo}`);
  // unicidade de negócio: 1ª linha ok, 2ª falha
  const conflitos = [];
  async function esperaConflito(nome, sql) {
    try {
      await prisma.$executeRawUnsafe(sql);
      conflitos.push({ nome, bloqueado: false });
    } catch (err) {
      conflitos.push({ nome, bloqueado: true, codigo: err.code ?? null });
      await prisma.$disconnect();
      await prisma.$connect();
    }
  }
  if (ids && (await temTabela("Refund"))) {
    await esperaConflito("refund-duplicado-pedido", `INSERT INTO "Refund" ("orderId","paymentId",amount,"idempotencyKey","updatedAt") VALUES ('${ids.order}','x',1,'k-dup',NOW())`);
  }
  if (ids && (await temTabela("OrderTrackToken"))) {
    await esperaConflito("token-duplicado-pedido", `INSERT INTO "OrderTrackToken" ("orderId","tokenHash","expiresAt","updatedAt") VALUES ('${ids.order}','hash-dup',NOW(),NOW())`);
  }
  if (relatorio.tabelasNovas.businessKey) {
    await esperaConflito("erp-businesskey-1", `INSERT INTO "ErpEvent" (tipo,payload,"businessKey","updatedAt") VALUES ('pedido_estornado','{}'::jsonb,'chk-bk-1',NOW())`);
    await esperaConflito("erp-businesskey-2", `INSERT INTO "ErpEvent" (tipo,payload,"businessKey","updatedAt") VALUES ('pedido_estornado','{}'::jsonb,'chk-bk-1',NOW())`);
  }
  if (relatorio.tabelasNovas.emailOutbox) {
    await esperaConflito("email-dedupe-1", `INSERT INTO "EmailOutbox" ("dedupeKey",kind,recipient,subject,"updatedAt") VALUES ('chk-dk-1','status','a@b.c','x',NOW())`);
    await esperaConflito("email-dedupe-2", `INSERT INTO "EmailOutbox" ("dedupeKey",kind,recipient,subject,"updatedAt") VALUES ('chk-dk-1','status','a@b.c','x',NOW())`);
  }
  relatorio.conflitosDeDados = conflitos;
  return relatorio;
}

// ---------- execução ----------
try {
  await criarBanco();
  let prisma = new PrismaClient({ datasourceUrl: URL });
  await prisma.$connect();
  let schemaDir = PRISMA;
  let ids = null;

  if (modo === "rebuild") {
    const stdout = await deploy(PRISMA);
    const aplicadas = (stdout.match(/Applying migration `([^`]+)`/g) || []).map((m) => m.match(/`([^`]+)`/)[1]);
    console.log(`[1] rebuild: ${aplicadas.length} migrations aplicadas em banco vazio (${NOME_DB})`);
    // inserts ORM+SQL no caminho que quebrou em produção (sem id)
    const resultados = {};
    try {
      const u = await prisma.user.create({ data: { email: `rc-${Date.now()}@dc.dev`, name: "RC", password: "x" } });
      const o = await prisma.order.create({ data: { number: `DC-RC-${Date.now()}`, userId: u.id, subtotal: 10, total: 10, paymentId: "p-rc" } });
      resultados.refund = (await prisma.refund.create({ data: { orderId: o.id, paymentId: "p-rc", amount: 10, status: "REQUESTED", idempotencyKey: `rc-${Date.now()}`, requestedBy: u.id } })).id ? "ok" : "?";
      resultados.token = (await prisma.orderTrackToken.create({ data: { orderId: o.id, tokenHash: "h-rc", expiresAt: new Date(Date.now() + 864e5) } })).id ? "ok" : "?";
      resultados.erpEvent = (await prisma.erpEvent.create({ data: { tipo: "pedido_estornado", payload: { numero: "DC-RC" }, businessKey: `pedido_estornado:${o.id}` } })).id ? "ok" : "?";
      resultados.emailOutbox = (await prisma.emailOutbox.create({ data: { recipient: "rc@dc.dev", kind: "status", subject: "x", html: "<p>x</p>", dedupeKey: `status:${o.id}:x` } })).id ? "ok" : "?";
      resultados.rateLimit = (await prisma.rateLimit.create({ data: { chave: `rl:${Date.now()}`, janelaInicio: new Date(), total: 1 } })).chave ? "ok" : "?";
    } catch (e) {
      resultados.erro = `${e.code ?? ""} ${e.message}`.replace(/\s+/g, " ").slice(0, 200);
    }
    console.log("[2] inserts ORM sem id:", JSON.stringify(resultados));
    const relatorio = await verificar(prisma, "rebuild", null, aplicadas);
    relatorio.insertsRebuild = resultados;
    console.log(JSON.stringify(relatorio, null, 1));
    await prisma.$disconnect();
  } else {
    schemaDir = await prepararBaseUpgrade();
    await prisma.$disconnect();
    prisma = new PrismaClient({ datasourceUrl: URL });
    await prisma.$connect();
    ids = await seed(prisma, modo);
    await prisma.$disconnect();
    prisma = new PrismaClient({ datasourceUrl: URL });
    await prisma.$connect();
    const stdout = await deploy(PRISMA);
    const aplicadas = (stdout.match(/Applying migration `([^`]+)`/g) || []).map((m) => m.match(/`([^`]+)`/)[1]);
    console.log(`[1] upgrade ${modo}: ${aplicadas.length} migrações pendentes aplicadas (${aplicadas.join(", ") || "nenhuma"})`);
    const relatorio = await verificar(prisma, modo, ids, aplicadas);
    console.log(JSON.stringify(relatorio, null, 1));
    await prisma.$disconnect();
  }
} finally {
  // limpa bases temporárias de upgrade
  for (const d of [".tmp-upgrade-legacy", ".tmp-upgrade-a", ".tmp-upgrade-b"]) {
    rmSync(join(REPO, d), { recursive: true, force: true });
  }
  try {
    await psql(`DROP DATABASE IF EXISTS ${NOME_DB};`);
  } catch {}
}
