import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { finalizarPedidoPago } from "@/lib/pedidos/finalizar";

// Nada de e-mail neste arquivo: a finalização dispara outbox + link de
// acompanhamento em fire-and-forget, que só poluiria o teste (sem provedor,
// ambos falham e são engolidos pelo catch). O que interessa aqui é o ESTADO
// transacional: estoque, cupom, status do pedido e a fila ErpEvent — todos em
// PostgreSQL REAL.
const { enfileirarEmailMock, processarOutboxMock, linkMock } = vi.hoisted(() => ({
  enfileirarEmailMock: vi.fn(async () => "outbox-1"),
  processarOutboxMock: vi.fn(async () => "ENVIADO"),
  linkMock: vi.fn(async () => ({ link: null })),
}));
vi.mock("@/lib/email-outbox", () => ({
  dedupeKeyStatusPedido: (orderId: string, status: string) => `status:${orderId}:${status}`,
  enfileirarEmail: enfileirarEmailMock,
  processarEmailOutbox: processarOutboxMock,
  enfileirarEmailStatusPedido: vi.fn(async () => "outbox-1"),
}));
vi.mock("@/lib/pedidos/notificar-status", () => ({
  montarLinkAcompanhamento: linkMock,
  deveNotificarStatus: () => false,
}));

// Só a ENTREGA do ERP é neutralizada (fire-and-forget pós-commit: usaria o
// singleton, que aponta para o banco errado neste arquivo). O enfileirarEvento
// continua REAL — é ele que grava na mesma transação da transição.
const { entregarEventoMock } = vi.hoisted(() => ({ entregarEventoMock: vi.fn(async () => false) }));
vi.mock("@/lib/erp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/erp")>()),
  entregarEvento: entregarEventoMock,
}));

// O `db` de finalizarPedidoPago é BancoFinalizar; o singleton é $extends-ado,
// então um PrismaClient "puro" não casa no generic. No runtime os delegates
// são idênticos; o cast só contorna o generic.
type BancoTeste = Parameters<typeof finalizarPedidoPago>[2];
const comoBanco = (p: PrismaClient): BancoTeste => p as unknown as BancoTeste;

// PostgreSQL REAL (não PGlite): o socket do PGlite multiplexa tudo numa única
// sessão backend e derruba transações concorrentes com 42P05. Duas conexões
// Prisma INDEPENDENTES garantem que a trava FOR UPDATE e a guarda condicional
// funcionem sob corrida verdadeira.
//
// Ambiente vem do SHELL (nada hardcoded):
//   node packages/database/scripts/pg-real.mjs setup
//   eval "$(node packages/database/scripts/pg-real.mjs env)"
const run = promisify(execFile);
const PRISMA_DIR = resolve(__dirname, "..", "..", "..", "..", "..", "packages", "database", "prisma");
const PG_HOST = process.env.PGHOST || "127.0.0.1";
const PG_PORT = process.env.PGPORT || "5433";
const PG_ENV = { ...process.env };
const BASE = `postgresql://postgres@${PG_HOST}:${PG_PORT}`;
const DB = "dc_checkout_integridade";
const url = `${BASE}/${DB}`;

let prismaA: PrismaClient;
let prismaB: PrismaClient;
let categoriaId: string;

beforeAll(async () => {
  try {
    await run("psql", ["-h", PG_HOST, "-p", PG_PORT, "-U", "postgres", "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${DB};`], { env: PG_ENV });
    await run("psql", ["-h", PG_HOST, "-p", PG_PORT, "-U", "postgres", "-d", "postgres", "-c", `CREATE DATABASE ${DB};`], { env: PG_ENV });
    await run("npx", ["prisma", "migrate", "deploy"], {
      cwd: PRISMA_DIR,
      env: { ...PG_ENV, DATABASE_URL: url },
    });
  } catch (e) {
    // Falha DURA e explicada — nunca vira skip silencioso.
    throw new Error(
      `Preparação do PostgreSQL real falhou em ${PG_HOST}:${PG_PORT} (banco ${DB}). ` +
        `Provisione e exporte o ambiente (packages/database/PG-REAL.md). ` +
        `Causa: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  prismaA = new PrismaClient({ datasourceUrl: url });
  prismaB = new PrismaClient({ datasourceUrl: url });
  await prismaA.$connect();
  await prismaB.$connect();
  const cat = await prismaA.category.create({
    data: { name: "Checkout", slug: `checkout-${Date.now()}` },
  });
  categoriaId = cat.id;
}, 240_000);

afterAll(async () => {
  await prismaA?.$disconnect();
  await prismaB?.$disconnect();
  await run("psql", ["-h", PG_HOST, "-p", PG_PORT, "-U", "postgres", "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${DB};`], { env: PG_ENV });
}, 60_000);

let seq = 0;
const unico = (p: string) => `${p}-${Date.now()}-${seq++}`;

// Zera contadores dos mocks de side-effect entre testes (fire-and-forget).
beforeEach(() => {
  enfileirarEmailMock.mockClear();
  processarOutboxMock.mockClear();
  entregarEventoMock.mockClear();
});

async function criarProduto(
  db: PrismaClient,
  opts: { stock: number; variacoes?: Array<{ size: string; color?: string | null; stock: number }> }
) {
  const produto = await db.product.create({
    data: {
      name: unico("Produto"),
      slug: unico("produto"),
      description: "x",
      price: 100,
      stock: opts.stock,
      categoryId: categoriaId,
      ...(opts.variacoes
        ? { variations: { create: opts.variacoes.map((v) => ({ size: v.size, color: v.color ?? null, stock: v.stock })) } }
        : {}),
    },
    include: { variations: true },
  });
  return produto;
}

async function criarPedido(
  db: PrismaClient,
  opts: {
    produtoId: string;
    itens: Array<{ size?: string | null; color?: string | null; quantity: number }>;
    cupom?: string;
    metodo?: "CARD" | "PIX";
    idempotencyKey?: string;
  }
) {
  return db.order.create({
    data: {
      number: unico("DC"),
      guestEmail: "teste@ex.local",
      status: "PENDING",
      paymentStatus: "PENDING",
      paymentMethod: opts.metodo ?? "PIX",
      couponCode: opts.cupom ?? null,
      subtotal: 100,
      total: 100,
      ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      items: {
        create: opts.itens.map((i) => ({
          productId: opts.produtoId,
          productName: "Produto",
          productSlug: "produto",
          size: i.size ?? null,
          color: i.color ?? null,
          quantity: i.quantity,
          unitPrice: 100,
          total: 100 * i.quantity,
        })),
      },
    },
  });
}

async function estadoPedido(db: PrismaClient, id: string) {
  const o = await db.order.findUnique({ where: { id }, select: { status: true, paymentStatus: true } });
  return o;
}

describe("finalizarPedidoPago — integridade de estoque em PostgreSQL real", () => {
  it("#4a duas linhas do MESMO produto somam: pedido 3+4 com saldo 5 é recusado (nunca -2)", async () => {
    const produto = await criarProduto(prismaA, {
      stock: 5,
      variacoes: [
        { size: "M", stock: 10 },
        { size: "G", stock: 10 },
      ],
    });
    const pedido = await criarPedido(prismaA, {
      produtoId: produto.id,
      itens: [
        { size: "M", quantity: 3 },
        { size: "G", quantity: 4 },
      ],
    });

    await expect(finalizarPedidoPago(pedido.id, "pay-1", comoBanco(prismaA))).rejects.toThrow(
      /Estoque insuficiente/
    );

    // Nada foi escrito: pedido segue PENDING e o saldo intacto.
    expect(await estadoPedido(prismaA, pedido.id)).toMatchObject({ paymentStatus: "PENDING" });
    const estoque = await prismaA.product.findUnique({ where: { id: produto.id } });
    expect(estoque?.stock).toBe(5);
  });

  it("#4b dois checkouts do ÚLTIMO item: um finaliza, o outro é recusado — saldo nunca negativo", async () => {
    const produto = await criarProduto(prismaA, { stock: 1 });
    const pedidoA = await criarPedido(prismaA, { produtoId: produto.id, itens: [{ quantity: 1 }] });
    const pedidoB = await criarPedido(prismaA, { produtoId: produto.id, itens: [{ quantity: 1 }] });

    const resultados = await Promise.allSettled([
      finalizarPedidoPago(pedidoA.id, "pay-a", comoBanco(prismaA)),
      finalizarPedidoPago(pedidoB.id, "pay-b", comoBanco(prismaB)),
    ]);

    const vitorias = resultados.filter((r) => r.status === "fulfilled");
    const derrotas = resultados.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(vitorias).toHaveLength(1);
    expect(derrotas).toHaveLength(1);
    expect(String(derrotas[0].reason)).toMatch(/Estoque insuficiente/);

    const estoque = await prismaA.product.findUnique({ where: { id: produto.id } });
    expect(estoque?.stock).toBe(0); // nunca negativo

    const pagos = await prismaA.order.count({
      where: { id: { in: [pedidoA.id, pedidoB.id] }, paymentStatus: "PAID" },
    });
    expect(pagos).toBe(1);
  });

  it("#4c duas encomendas da MESMA variação: trava da variação impede oversell", async () => {
    const produto = await criarProduto(prismaA, {
      stock: 5,
      variacoes: [{ size: "P", stock: 1 }],
    });
    const variacao = produto.variations[0];
    const pedidoA = await criarPedido(prismaA, {
      produtoId: produto.id,
      itens: [{ size: "P", quantity: 1 }],
    });
    const pedidoB = await criarPedido(prismaA, {
      produtoId: produto.id,
      itens: [{ size: "P", quantity: 1 }],
    });

    const resultados = await Promise.allSettled([
      finalizarPedidoPago(pedidoA.id, "pay-a", comoBanco(prismaA)),
      finalizarPedidoPago(pedidoB.id, "pay-b", comoBanco(prismaB)),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const depois = await prismaA.productVariation.findUnique({ where: { id: variacao.id } });
    expect(depois?.stock).toBe(0);
  });
});

describe("finalizarPedidoPago — idempotência sob webhook duplicado/concorrente", () => {
  it("#3 duas notificações simultâneas do MESMO pedido: estoque e cupom baixam UMA vez só", async () => {
    const produto = await criarProduto(prismaA, { stock: 10 });
    const cupom = await prismaA.coupon.create({
      data: { code: unico("CUPOM"), type: "PERCENT", value: 10, maxUses: 5, usedCount: 0 },
    });
    const pedido = await criarPedido(prismaA, {
      produtoId: produto.id,
      itens: [{ quantity: 2 }],
      cupom: cupom.code,
    });

    // Barreira: as duas conexões disparam juntas. Uma trava a linha do pedido
    // e finaliza; a outra espera a trava e, ao recarregar, vê PAID e sai.
    const [rA, rB] = await Promise.all([
      finalizarPedidoPago(pedido.id, "pay-1", comoBanco(prismaA)),
      finalizarPedidoPago(pedido.id, "pay-1", comoBanco(prismaB)),
    ]);

    expect([rA, rB].filter((r) => !r.jaFinalizado)).toHaveLength(1);
    expect([rA, rB].filter((r) => r.jaFinalizado)).toHaveLength(1);

    const estoque = await prismaA.product.findUnique({ where: { id: produto.id } });
    expect(estoque?.stock).toBe(8); // 10 - 2, uma única vez

    const cupomDepois = await prismaA.coupon.findUnique({ where: { code: cupom.code } });
    expect(cupomDepois?.usedCount).toBe(1); // incremento único

    const eventosPagos = await prismaA.erpEvent.count({
      where: { businessKey: `pedido_pago:${pedido.id}` },
    });
    expect(eventosPagos).toBe(1); // businessKey única por pedido

    // O e-mail sai em fire-and-forget (mock): UMA tentativa de enfileirar,
    // nunca uma por notificação recebida.
    expect(enfileirarEmailMock).toHaveBeenCalledTimes(1);
    expect(enfileirarEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: `status:${pedido.id}:PAID` })
    );
  });

  it("#3 webhook repetido (sequencial) também é inexistente de efeito", async () => {
    const produto = await criarProduto(prismaA, { stock: 10 });
    const pedido = await criarPedido(prismaA, { produtoId: produto.id, itens: [{ quantity: 1 }] });

    const primeira = await finalizarPedidoPago(pedido.id, "pay-1", comoBanco(prismaA));
    const segunda = await finalizarPedidoPago(pedido.id, "pay-1", comoBanco(prismaA));

    expect(primeira).toEqual({ ok: true, jaFinalizado: false });
    expect(segunda).toEqual({ ok: true, jaFinalizado: true });

    const estoque = await prismaA.product.findUnique({ where: { id: produto.id } });
    expect(estoque?.stock).toBe(9);
  });
});

describe("cupom — maxUses nunca é ultrapassado", () => {
  it("#5 dois pedidos concorrentes com cupom de 1 uso: usedCount fica em 1", async () => {
    const produto = await criarProduto(prismaA, { stock: 10 });
    const cupom = await prismaA.coupon.create({
      data: { code: unico("UNICO"), type: "PERCENT", value: 10, maxUses: 1, usedCount: 0 },
    });
    const pedidoA = await criarPedido(prismaA, {
      produtoId: produto.id,
      itens: [{ quantity: 1 }],
      cupom: cupom.code,
    });
    const pedidoB = await criarPedido(prismaA, {
      produtoId: produto.id,
      itens: [{ quantity: 1 }],
      cupom: cupom.code,
    });

    await Promise.allSettled([
      finalizarPedidoPago(pedidoA.id, "pay-a", comoBanco(prismaA)),
      finalizarPedidoPago(pedidoB.id, "pay-b", comoBanco(prismaB)),
    ]);

    const depois = await prismaA.coupon.findUnique({ where: { code: cupom.code } });
    // Invariante: o contador nunca passa do limite, mesmo em corrida.
    expect(depois?.usedCount).toBe(1);
    expect(depois!.usedCount).toBeLessThanOrEqual(depois!.maxUses!);
  });

  it("#5 cupom já esgotado: incremento é recusado e o pedido PAGO não fica pendurado", async () => {
    const produto = await criarProduto(prismaA, { stock: 10 });
    const cupom = await prismaA.coupon.create({
      data: { code: unico("ESGOTADO"), type: "PERCENT", value: 10, maxUses: 1, usedCount: 1 },
    });
    const pedido = await criarPedido(prismaA, {
      produtoId: produto.id,
      itens: [{ quantity: 1 }],
      cupom: cupom.code,
    });

    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await finalizarPedidoPago(pedido.id, "pay-1", comoBanco(prismaA));
    erro.mockRestore();

    // O pagamento é irreversível: o pedido confirma, mas o contador não passa
    // do limite (e o incidente fica visível no log).
    expect(r).toEqual({ ok: true, jaFinalizado: false });
    const depois = await prismaA.coupon.findUnique({ where: { code: cupom.code } });
    expect(depois?.usedCount).toBe(1);
    expect(await estadoPedido(prismaA, pedido.id)).toMatchObject({ paymentStatus: "PAID" });
  });
});

describe("Order.idempotencyKey — o mesmo checkout nunca vira dois pedidos", () => {
  it("#2 duas requisições com a MESMA chave: só UMA linha existe no banco", async () => {
    const produto = await criarProduto(prismaA, { stock: 10 });
    const chave = `chk-${crypto.randomUUID()}`;

    const resultados = await Promise.allSettled([
      criarPedido(prismaA, { produtoId: produto.id, itens: [{ quantity: 1 }], idempotencyKey: chave }),
      criarPedido(prismaB, { produtoId: produto.id, itens: [{ quantity: 1 }], idempotencyKey: chave }),
    ]);

    const sucessos = resultados.filter((r) => r.status === "fulfilled");
    const falhas = resultados.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    // Exatamente um cria; o outro perde para o índice único.
    expect(sucessos).toHaveLength(1);
    expect(falhas).toHaveLength(1);
    expect((falhas[0].reason as { code?: string })?.code).toBe("P2002");

    const total = await prismaA.order.count({ where: { idempotencyKey: chave } });
    expect(total).toBe(1);
  });

  it("#2 chaves diferentes seguem criando pedidos distintos (sem falso positivo)", async () => {
    const produto = await criarProduto(prismaA, { stock: 10 });
    await criarPedido(prismaA, {
      produtoId: produto.id,
      itens: [{ quantity: 1 }],
      idempotencyKey: `chk-${crypto.randomUUID()}`,
    });
    await criarPedido(prismaA, {
      produtoId: produto.id,
      itens: [{ quantity: 1 }],
      idempotencyKey: `chk-${crypto.randomUUID()}`,
    });
    expect(await prismaA.order.count({ where: { paymentStatus: "PENDING" } })).toBeGreaterThan(1);
  });
});
