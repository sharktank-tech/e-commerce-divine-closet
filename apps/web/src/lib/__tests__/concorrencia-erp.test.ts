import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { enfileirarEvento, type EnfileirarOpcoes } from "@/lib/erp";

// O `db` de enfileirarEvento é Pick<typeof prismaSingleton, "erpEvent"> — o
// singleton é $extends-ado (extensão de query em product), então um
// PrismaClient "puro" não casa no tipo. No runtime o delegate erpEvent é
// idêntico; o cast abaixo só contorna o generic, sem esconder comportamento.
type Db = NonNullable<EnfileirarOpcoes["db"]>;
const comoDb = (p: PrismaClient): Db => p as unknown as Db;

// Concorrência real em PostgreSQL REAL (servidor 17.11 em 127.0.0.1:5433,
// não PGlite — o socket server do PGlite multiplexa tudo numa única sessão
// backend e derruba transações concorrentes com 42P05). Duas conexões
// Prisma INDEPENDENTES garantem que o ON CONFLICT de ErpEvent.businessKey
// funciona sob corrida verdadeira, sem exceção e sem abortar a transação
// do chamador (que abortaria a transição de negócio junto no fluxo real).
//
// Banco dedicado dc_concorrencia (isolado); `prisma migrate deploy` no
// beforeAll prova o histórico completo também em PostgreSQL real.

const run = promisify(execFile);
const PRISMA_DIR = resolve(__dirname, "..", "..", "..", "..", "..", "packages", "database", "prisma");
const PG_ENV = {
  ...process.env,
  PATH: "/home/opencode/projects/tmp-exp/pg-real-bin:" + process.env.PATH,
  LD_LIBRARY_PATH:
    "/home/opencode/.local/pgalpine/usr/lib:/home/opencode/.local/pgalpine/usr/lib/postgresql17",
  LD_PRELOAD: "/home/opencode/.local/pgalpine/usr/lib/libnss_wrapper.so",
  NSS_WRAPPER_PASSWD: "/home/opencode/projects/tmp-exp/pg-real-bin/passwd",
  NSS_WRAPPER_GROUP: "/home/opencode/projects/tmp-exp/pg-real-bin/group",
  ICU_DATA: "/home/opencode/.local/pgalpine/usr/share/icu/78.1",
};

const BASE = "postgresql://postgres@127.0.0.1:5433";
const DB_CONCORRENCIA = "dc_concorrencia";

async function criarBanco(url: string, nome: string): Promise<void> {
  await run("psql", ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${nome};`], { env: PG_ENV });
  await run("psql", ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "postgres", "-c", `CREATE DATABASE ${nome};`], { env: PG_ENV });
}

async function migrar(url: string): Promise<void> {
  await run("npx", ["prisma", "migrate", "deploy"], {
    cwd: PRISMA_DIR,
    env: { ...PG_ENV, DATABASE_URL: url },
  });
}

const url = `${BASE}/${DB_CONCORRENCIA}`;
let prismaA: PrismaClient;
let prismaB: PrismaClient;

beforeAll(async () => {
  await criarBanco(BASE, DB_CONCORRENCIA);
  await migrar(url);
  prismaA = new PrismaClient({ datasourceUrl: url });
  prismaB = new PrismaClient({ datasourceUrl: url });
  await prismaA.$connect();
  await prismaB.$connect();
}, 180_000);

afterAll(async () => {
  await prismaA?.$disconnect();
  await prismaB?.$disconnect();
  await run("psql", ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${DB_CONCORRENCIA};`], { env: PG_ENV });
}, 60_000);

describe("ErpEvent.businessKey — corrida real em PostgreSQL (duas conexões independentes)", () => {
  it("duas transações simultâneas com a MESMA businessKey: 1 evento, ambas devolvem o mesmo id, nenhuma exceção", async () => {
    const chave = `pedido_estornado:corrida-${crypto.randomUUID()}`;
    // Barreira: dispara as duas conexões ao mesmo tempo (pré-cheque de ambas
    // passa; o INSERT de uma perde pro índice único e vira ON CONFLICT DO NOTHING).
    const [idA, idB] = await Promise.all([
      enfileirarEvento("pedido_estornado", { numero: "DC-C1" }, { businessKey: chave, db: comoDb(prismaA) }),
      enfileirarEvento("pedido_estornado", { numero: "DC-C1" }, { businessKey: chave, db: comoDb(prismaB) }),
    ]);
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).toBe(idB); // mesma ocorrência → mesmo event_id
    const total = await prismaA.erpEvent.count({ where: { businessKey: chave } });
    expect(total).toBe(1); // nunca duplica
  });

  it("corrida estilo estorno: transação de negócio + enfileirarEvento — ambas COMMITam, sem 400/erro inesperado", async () => {
    // Reproduz o padrão real: tx = updateMany de guarda (condicional) + enfileirarEvento.
    const chave = `pedido_estornado:estorno-${crypto.randomUUID()}`;
    const order = await prismaA.order.create({
      data: {
        number: `C-${crypto.randomUUID()}`,
        guestEmail: "corrida@ex.local",
        subtotal: 32.99,
        total: 32.99,
        paymentStatus: "PAID",
      },
    });
    async function estornar(prisma: PrismaClient): Promise<{ ganhou: boolean; event_id: string | null }> {
      return prisma.$transaction(async (tx) => {
        const r = await tx.order.updateMany({
          where: { id: order.id, paymentStatus: "PAID" },
          data: { paymentStatus: "REFUNDED" },
        });
        if (r.count === 0) return { ganhou: false, event_id: null };
        const event_id = await enfileirarEvento("pedido_estornado", { orderId: order.id }, { businessKey: chave, db: tx as unknown as Db });
        return { ganhou: true, event_id };
      });
    }
    const [resA, resB] = await Promise.all([estornar(prismaA), estornar(prismaB)]);
    // Só uma transição vence a guarda updateMany; a outra não enfileira evento.
    const vencedores = [resA, resB].filter((r) => r.ganhou);
    expect(vencedores).toHaveLength(1);
    expect(vencedores[0].event_id).toBeTruthy();
    // Ambas as transações COMMITaram (nenhuma exceção abortou a tx perdedora).
    const estado = await prismaA.order.findUnique({ where: { id: order.id }, select: { paymentStatus: true } });
    expect(estado?.paymentStatus).toBe("REFUNDED"); // transição aplicada
    const eventos = await prismaA.erpEvent.count({ where: { businessKey: chave } });
    expect(eventos).toBe(1); // exatamente um evento, não um por transação
  });

  it("corrida sem guarda (duas transações gravam evento de negócio distinto com MESMA businessKey): só 1 evento, ambas COMMITam", async () => {
    // Admin PATCH CANCELLED não tem guarda condicional — as duas transações
    // prosseguem até enfileirarEvento. O ON CONFLICT DO NOTHING mantém as
    // duas transações válidas; só uma linha sobrevive.
    const chave = `pedido_cancelado:cancel-${crypto.randomUUID()}`;
    const order = await prismaA.order.create({
      data: {
        number: `C-${crypto.randomUUID()}`,
        guestEmail: "cancel@ex.local",
        subtotal: 10,
        total: 10,
      },
    });
    async function cancelar(prisma: PrismaClient): Promise<void> {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
        await enfileirarEvento("pedido_cancelado", { orderId: order.id }, { businessKey: chave, db: tx as unknown as Db });
      });
    }
    // Duas transações simultâneas, mesmas escritas — nenhuma deve lançar.
    await expect(Promise.all([cancelar(prismaA), cancelar(prismaB)])).resolves.toBeDefined();
    const eventos = await prismaA.erpEvent.count({ where: { businessKey: chave } });
    expect(eventos).toBe(1); // corrida não duplica
    const estado = await prismaA.order.findUnique({ where: { id: order.id }, select: { status: true } });
    expect(estado?.status).toBe("CANCELLED"); // transição gravada em ambas
  });

  it("rollback da tx de negócio NÃO deixa evento órfão (evento só vive se a tx commitar)", async () => {
    const chave = `pedido_pago:rollback-${crypto.randomUUID()}`;
    const order = await prismaA.order.create({
      data: {
        number: `C-${crypto.randomUUID()}`,
        guestEmail: "rollback@ex.local",
        subtotal: 5,
        total: 5,
      },
    });
    await expect(
      prismaA.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });
        await enfileirarEvento("pedido_pago", { orderId: order.id }, { businessKey: chave, db: tx as unknown as Db });
        throw new Error("falha simulada pós-enfileirar"); // força rollback
      })
    ).rejects.toThrow(/falha simulada/);
    const eventos = await prismaA.erpEvent.count({ where: { businessKey: chave } });
    expect(eventos).toBe(0); // evento descartado junto com a transição
    const estado = await prismaA.order.findUnique({ where: { id: order.id }, select: { paymentStatus: true } });
    expect(estado?.paymentStatus).toBe("PENDING"); // transição também desfeita
  });

  it("businessKeys DIFERENTES em corrida: duas linhas, ambas gravadas", async () => {
    const chave1 = `pedido_pago:distinct-${crypto.randomUUID()}`;
    const chave2 = `pedido_pago:distinct-${crypto.randomUUID()}-b`;
    await Promise.all([
      enfileirarEvento("pedido_pago", { numero: "1" }, { businessKey: chave1, db: comoDb(prismaA) }),
      enfileirarEvento("pedido_pago", { numero: "2" }, { businessKey: chave2, db: comoDb(prismaB) }),
    ]);
    expect(await prismaA.erpEvent.count({ where: { businessKey: { in: [chave1, chave2] } } })).toBe(2);
  });

  it("falha de banco REAL (tabela ausente) é PROPAGADA — não vira 'evento já existente'", async () => {
    // Simula falha real de persistência: move a tabela e espera erro visível,
    // não um id devolvido como se fosse idempotência.
    await prismaA.$executeRawUnsafe(`ALTER TABLE "ErpEvent" RENAME TO "ErpEvent_tmp_conflito"`);
    await expect(
      enfileirarEvento("pedido_pago", { numero: "x" }, { businessKey: `err-${crypto.randomUUID()}`, db: comoDb(prismaA) })
    ).rejects.toThrow();
    await prismaA.$executeRawUnsafe(`ALTER TABLE "ErpEvent_tmp_conflito" RENAME TO "ErpEvent"`);
  });
});
