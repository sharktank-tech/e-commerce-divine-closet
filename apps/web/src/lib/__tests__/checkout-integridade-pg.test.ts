import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { POST as criarCheckout } from "@/app/api/pedidos/route";
import { POST as webhook } from "@/app/api/pagamentos/webhook/route";
import { reconciliarPixPendentes } from "@/lib/reconciliar-pix";
import { liberarCupomReservado } from "@/lib/pedidos/cupom-reserva";
import { finalizarPedidoPago } from "@/lib/pedidos/finalizar";

const conexao = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, {
  get: (_target, prop) => {
    if (!conexao.client) throw new Error("DB de teste não inicializado");
    const value = Reflect.get(conexao.client, prop);
    return typeof value === "function" ? value.bind(conexao.client) : value;
  },
}) }));
vi.mock("@/lib/auth", () => ({ getSession: async () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: vi.fn() }) }));
vi.mock("@/lib/config-loja", () => ({
  getPagamento: async () => ({ pix: true, card: true, boleto: false }),
  getFrete: async () => ({ fixed: 0, freeFrom: 0 }),
}));

// Nada de e-mail neste arquivo: a finalização dispara outbox + link de
// acompanhamento em fire-and-forget, que só poluiria o teste (sem provedor,
// ambos falham e são engolidos pelo catch). O que interessa aqui é o ESTADO
// transacional: estoque, cupom, status do pedido e a fila ErpEvent — todos em
// PostgreSQL REAL.
const { enfileirarEmailMock, processarOutboxMock, linkMock } = vi.hoisted(() => ({
  enfileirarEmailMock: vi.fn<typeof import("@/lib/email-outbox").enfileirarEmail>(),
  processarOutboxMock: vi.fn(async () => "ENVIADO"),
  linkMock: vi.fn(async () => ({ link: null })),
}));
vi.mock("@/lib/email-outbox", async (original) => {
  const real = await original<typeof import("@/lib/email-outbox")>();
  enfileirarEmailMock.mockImplementation(real.enfileirarEmail);
  return ({
  dedupeKeyStatusPedido: (orderId: string, status: string) => `status:${orderId}:${status}`,
  enfileirarEmail: enfileirarEmailMock,
  processarEmailOutbox: processarOutboxMock,
  enfileirarEmailStatusPedido: vi.fn(async () => "outbox-1"),
}); });
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
  conexao.client = prismaA;
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

    const r = await finalizarPedidoPago(pedido.id, "pay-1", comoBanco(prismaA));
    // Retenção: pagamento aprovado, pedido em hold (status=PENDING, paymentStatus=PAID)
    expect(r).toMatchObject({ ok: true, jaFinalizado: false, emEspera: true, hold: "ESTOQUE_INSUFICIENTE" });

    // Pedido segue PENDING (hold) e o saldo intacto.
    const estado = await estadoPedido(prismaA, pedido.id);
    expect(estado?.status).toBe("PENDING");
    expect(estado?.paymentStatus).toBe("PAID");
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

    // Um finaliza (PAID), o outro entra em hold (estoque insuficiente)
    const fulfilled = resultados.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);

    const pagos = await prismaA.order.count({
      where: { id: { in: [pedidoA.id, pedidoB.id] }, status: "PAID" },
    });
    expect(pagos).toBe(1);

    const estoque = await prismaA.product.findUnique({ where: { id: produto.id } });
    expect(estoque?.stock).toBe(0); // nunca negativo

    const holdCount = await prismaA.order.count({
      where: { id: { in: [pedidoA.id, pedidoB.id] }, status: "PENDING" },
    });
    expect(holdCount).toBe(1);
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
    // Um finaliza (fulfilled), o outro entra em hold (fulfilled também, pois não lança erro)
    const fulfilled = resultados.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);

    const depois = await prismaA.productVariation.findUnique({ where: { id: variacao.id } });
    expect(depois?.stock).toBe(0);

    const pagos = await prismaA.order.count({
      where: { id: { in: [pedidoA.id, pedidoB.id] }, status: "PAID" },
    });
    expect(pagos).toBe(1);

    const holdCount = await prismaA.order.count({
      where: { id: { in: [pedidoA.id, pedidoB.id] }, status: "PENDING" },
    });
    expect(holdCount).toBe(1);
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
    expect(eventosPagos).toBe(1);
    expect(await prismaA.emailOutbox.count({ where: { dedupeKey: `status:${pedido.id}:PAID` } })).toBe(1); // businessKey única por pedido

    // O e-mail sai em fire-and-forget (mock): UMA tentativa de enfileirar,
    // nunca uma por notificação recebida.
    expect(enfileirarEmailMock).toHaveBeenCalledTimes(1);
    expect(enfileirarEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: `status:${pedido.id}:PAID` }),
      expect.anything()
    );
  });

  it("#3 webhook repetido (sequencial) também é inexistente de efeito", async () => {
    const produto = await criarProduto(prismaA, { stock: 10 });
    const pedido = await criarPedido(prismaA, { produtoId: produto.id, itens: [{ quantity: 1 }] });

    const primeira = await finalizarPedidoPago(pedido.id, "pay-1", comoBanco(prismaA));
    const segunda = await finalizarPedidoPago(pedido.id, "pay-1", comoBanco(prismaA));

    expect(primeira).toMatchObject({ ok: true, jaFinalizado: false, emEspera: false, hold: null });
    expect(segunda).toMatchObject({ ok: true, jaFinalizado: true });

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
    expect(r).toMatchObject({ ok: true, jaFinalizado: false, emEspera: false, hold: null });
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


// Rotas e serviços reais + PostgreSQL real. Apenas a rede/provedores de saída são simulados.
describe("checkout — interrupções e retomadas nas rotas reais", () => {
  type Raw = { id: number; status: string; external_reference: string; currency_id: string; transaction_amount: number };
  let pagamentos: Map<string, Raw>;
  let chamadas: Array<{ key: string; body: Record<string, unknown> }>;
  let aposCriar: ((p: Raw) => Promise<void>) | null;
  let buscaVazia: boolean;
  let respostaIncompleta: boolean;

  beforeEach(async () => {
    await prismaA.order.updateMany({ data: { createdAt: new Date() } });
    pagamentos = new Map(); chamadas = []; aposCriar = null; buscaVazia = false; respostaIncompleta = false;
    vi.stubEnv("PAYMENT_DRIVER", "mercadopago"); vi.stubEnv("MP_ACCESS_TOKEN", "test-only");
    vi.stubEnv("MP_WEBHOOK_SECRET", ""); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).startsWith("https://api.mercadopago.com/v1/payments")) throw new Error("Rede externa não permitida no teste");
      if (init?.method === "POST") {
        const key = (init.headers as Record<string, string>)["X-Idempotency-Key"];
        const body = JSON.parse(String(init.body)); chamadas.push({ key, body });
        let p = pagamentos.get(key);
        if (!p) {
          p = { id: pagamentos.size + 100, status: "pending", external_reference: body.external_reference,
            currency_id: "BRL", transaction_amount: body.transaction_amount };
          pagamentos.set(key, p);
        }
        if (aposCriar) await aposCriar(p);
        return { ok: true, json: async () => respostaIncompleta ? { status: "approved" } : p };
      }
      const u = new URL(url);
      if (u.pathname.endsWith("/search")) return { ok: true, json: async () => ({
        results: buscaVazia ? [] : [...pagamentos.values()].filter(p => p.external_reference === u.searchParams.get("external_reference")),
      }) };
      const p = [...pagamentos.values()].find(p => String(p.id) === u.pathname.split("/").pop());
      if (!p) throw new Error("Pagamento não encontrado no provedor simulado");
      return { ok: true, json: async () => p };
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const body = () => ({ guest: { email: "ana@example.com", name: "Ana Silva" }, payment: { method: "pix" },
    address: { street: "Rua Teste", neighborhood: "Centro", city: "Palmas", state: "TO", zipCode: "77000000" } });
  const req = (key: string, guestId = "", override: Record<string, unknown> = {}) => new NextRequest("https://example.com/api/pedidos", {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key, Cookie: `dc_guest=${guestId}` },
    body: JSON.stringify({ ...body(), ...override }),
  });
  const notificar = (id: number) => webhook(new NextRequest("https://example.com/api/pagamentos/webhook", {
    method: "POST", body: JSON.stringify({ type: "payment", data: { id } }),
  }));
  async function orfao() {
    const produto = await criarProduto(prismaA, { stock: 10 });
    const key = unico("replay");
    const pedido = await criarPedido(prismaA, { produtoId: produto.id, itens: [{ quantity: 1 }], idempotencyKey: key });
    await prismaA.order.update({ where: { id: pedido.id }, data: { guestEmail: "ana@example.com", paymentRequestHash: createHash("sha256").update(JSON.stringify({ method: "pix", payerEmail: "ana@example.com", installments: 1, paymentMethodId: null })).digest("hex") } });
    return { produto, pedido, key };
  }
  async function carrinho() {
    const produto = await criarProduto(prismaA, { stock: 10 });
    const guestId = unico("guest");
    await prismaA.cart.create({ data: { guestId, items: { create: { productId: produto.id, quantity: 1, unitPrice: 100 } } } });
    return { produto, guestId, key: unico("checkout") };
  }
  const envelhecer = (id: string) => prismaA.order.update({ where: { id }, data: { createdAt: new Date(Date.now() - 200 * 3600000) } });

  it("duas retomadas simultâneas antes da chamada: mesmo pedido, chave e payload; uma cobrança efetiva", async () => {
    const { pedido, key } = await orfao();
    const [a, b] = await Promise.all([criarCheckout(req(key)), criarCheckout(req(key))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(chamadas).toHaveLength(2); expect(chamadas[0]).toEqual(chamadas[1]);
    expect(pagamentos.size).toBe(1);
    expect((await prismaA.order.findUniqueOrThrow({ where: { id: pedido.id } })).paymentId).toBe("100");
    expect(await prismaA.order.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it("timeout APÓS aceitação: replay com carrinho vazio recupera a mesma cobrança", async () => {
    const { guestId, key } = await carrinho();
    aposCriar = async () => { throw new Error("timeout após aceitação"); };
    expect((await criarCheckout(req(key, guestId))).status).toBe(502);
    const pedido = await prismaA.order.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(pedido).toMatchObject({ status: "PENDING", paymentStatus: "PENDING", paymentId: null });
    await prismaA.cartItem.deleteMany({ where: { cart: { guestId } } });
    aposCriar = null;
    expect((await criarCheckout(req(key))).status).toBe(200);
    expect(pagamentos.size).toBe(1); expect(chamadas[0]).toEqual(chamadas[1]);
  });

  it("webhook na barreira antes de salvar paymentId finaliza; resposta pending tardia não regride", async () => {
    const { guestId, key, produto } = await carrinho();
    aposCriar = async p => {
      p.status = "approved";
      expect((await notificar(p.id)).status).toBe(200);
      p.status = "pending"; // snapshot atrasado da resposta de criação
    };
    expect((await criarCheckout(req(key, guestId))).status).toBe(201);
    const pedido = await prismaA.order.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(pedido).toMatchObject({ status: "PAID", paymentStatus: "PAID", paymentId: "100" });
    expect((await prismaA.product.findUniqueOrThrow({ where: { id: produto.id } })).stock).toBe(9);
    expect(await prismaA.erpEvent.count({ where: { businessKey: `pedido_pago:${pedido.id}` } })).toBe(1);
  });

  it("recusa tardia na criação não sobrescreve aprovação pelo webhook", async () => {
    const { guestId, key } = await carrinho();
    aposCriar = async p => { p.status = "approved"; await notificar(p.id); p.status = "rejected"; };
    await criarCheckout(req(key, guestId));
    expect(await prismaA.order.findUniqueOrThrow({ where: { idempotencyKey: key } })).toMatchObject({ status: "PAID", paymentStatus: "PAID" });
  });

  it("busca vazia mesmo após a janela não cancela; aprovação posterior recupera paymentId nulo", async () => {
    const { pedido, key, produto } = await orfao(); await envelhecer(pedido.id);
    pagamentos.set(key, { id: 100, status: "approved", external_reference: pedido.id, currency_id: "BRL", transaction_amount: 100 });
    buscaVazia = true;
    await reconciliarPixPendentes({ token: "test-only" });
    expect(await prismaA.order.findUniqueOrThrow({ where: { id: pedido.id } })).toMatchObject({ status: "PENDING", paymentId: null });
    buscaVazia = false;
    await reconciliarPixPendentes({ token: "test-only" });
    expect(await prismaA.order.findUniqueOrThrow({ where: { id: pedido.id } })).toMatchObject({ status: "PAID", paymentId: "100" });
    expect((await prismaA.product.findUniqueOrThrow({ where: { id: produto.id } })).stock).toBe(9);
  });

  it("duas aprovações distintas ficam em revisão persistida, sem baixa ou estorno automático", async () => {
    const { pedido, key, produto } = await orfao(); await envelhecer(pedido.id);
    for (const id of [100, 101]) pagamentos.set(`${key}-${id}`, { id, status: "approved", external_reference: pedido.id, currency_id: "BRL", transaction_amount: 100 });
    await reconciliarPixPendentes({ token: "test-only" });
    const depois = await prismaA.order.findUniqueOrThrow({ where: { id: pedido.id } });
    expect(depois).toMatchObject({ status: "PENDING", holdCode: "REVISAO_FINANCEIRA" });
    expect(depois.holdReason).toContain("100,101");
    expect((await prismaA.product.findUniqueOrThrow({ where: { id: produto.id } })).stock).toBe(10);
    expect(await prismaA.refund.count({ where: { orderId: pedido.id } })).toBe(0);
    expect(chamadas).toHaveLength(0);
  });

  it("resposta sem id deixa estado recuperável; não salva String(undefined)", async () => {
    const { guestId, key } = await carrinho(); respostaIncompleta = true;
    expect((await criarCheckout(req(key, guestId))).status).toBe(502);
    expect(await prismaA.order.findUniqueOrThrow({ where: { idempotencyKey: key } })).toMatchObject({ status: "PENDING", paymentId: null });
  });

  it("replay com retenção financeira nunca inicia outra cobrança", async () => {
    const { pedido, key } = await orfao();
    await prismaA.order.update({ where: { id: pedido.id }, data: { holdCode: "REVISAO_FINANCEIRA" } });
    expect((await criarCheckout(req(key))).status).toBe(409);
    expect(chamadas).toHaveLength(0);
  });

  it("tentativa legada sem hash/ID exige reconciliação e nunca dispara nova cobrança", async () => {
    const { pedido, key } = await orfao();
    await prismaA.order.update({ where: { id: pedido.id }, data: { paymentRequestHash: null } });
    expect((await criarCheckout(req(key))).status).toBe(409);
    expect(chamadas).toHaveLength(0);
  });

  it("retry não pode alterar os parâmetros de pagamento persistidos", async () => {
    const { guestId, key } = await carrinho();
    expect((await criarCheckout(req(key, guestId))).status).toBe(201);
    expect((await criarCheckout(req(key, "", { payment: { method: "pix", installments: 2 } }))).status).toBe(409);
    expect(chamadas).toHaveLength(1);
  });

  it("recusa antiga não esconde outra tentativa aprovada na busca real", async () => {
    const { pedido, key, produto } = await orfao(); await envelhecer(pedido.id);
    await prismaA.order.update({ where: { id: pedido.id }, data: { paymentId: "100" } });
    pagamentos.set(key, { id: 100, status: "rejected", external_reference: pedido.id, currency_id: "BRL", transaction_amount: 100 });
    pagamentos.set(`${key}-approved`, { id: 101, status: "approved", external_reference: pedido.id, currency_id: "BRL", transaction_amount: 100 });
    await reconciliarPixPendentes({ token: "test-only" });
    expect(await prismaA.order.findUniqueOrThrow({ where: { id: pedido.id } })).toMatchObject({ status: "PAID", paymentId: "101" });
    expect((await prismaA.product.findUniqueOrThrow({ where: { id: produto.id } })).stock).toBe(9);
  });

  it("segunda aprovação após finalização gera retenção visível sem duplicar efeitos", async () => {
    const { pedido, key, produto } = await orfao();
    const p = { id: 100, status: "approved", external_reference: pedido.id, currency_id: "BRL", transaction_amount: 100 };
    pagamentos.set(key, p); await notificar(100);
    pagamentos.set(`${key}-second`, { ...p, id: 101 }); await notificar(101);
    const depois = await prismaA.order.findUniqueOrThrow({ where: { id: pedido.id } });
    expect(depois).toMatchObject({ status: "PAID", paymentStatus: "PAID", paymentId: "100", holdCode: "REVISAO_FINANCEIRA" });
    expect((await prismaA.product.findUniqueOrThrow({ where: { id: produto.id } })).stock).toBe(9);
    expect(await prismaA.emailOutbox.count({ where: { orderId: pedido.id } })).toBe(1);
  });

  it("erro de transporte não é busca vazia e mantém pedido/reserva recuperáveis", async () => {
    const { pedido } = await orfao(); await envelhecer(pedido.id);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("indisponível"));
    const resumo = await reconciliarPixPendentes({ token: "test-only" });
    expect(resumo.erros).toBeGreaterThanOrEqual(1);
    expect(await prismaA.order.findUniqueOrThrow({ where: { id: pedido.id } })).toMatchObject({ status: "PENDING", paymentStatus: "PENDING" });
  });

  it("chave de outra pessoa não revela pedido nem cria cobrança", async () => {
    const { key } = await orfao();
    const res = await criarCheckout(req(key, "", { guest: { email: "outra@example.com", name: "Outra Pessoa" } }));
    expect(res.status).toBe(409); expect(chamadas).toHaveLength(0);
    expect(await res.json()).not.toHaveProperty("order");
  });
});

describe("reserva de cupom — posse por pedido em PG real", () => {
  it("liberação concorrente/repetida só devolve a reserva do próprio pedido uma vez", async () => {
    const produto = await criarProduto(prismaA, { stock: 10 });
    const cupom = await prismaA.coupon.create({ data: { code: unico("RESERVA"), type: "FIXED", value: 1, usedCount: 2, maxUses: 2 } });
    const pedido = await criarPedido(prismaA, { produtoId: produto.id, itens: [{ quantity: 1 }], cupom: cupom.code });
    const outro = await criarPedido(prismaA, { produtoId: produto.id, itens: [{ quantity: 1 }], cupom: cupom.code });
    await prismaA.order.update({ where: { id: pedido.id }, data: { status: "CANCELLED", paymentStatus: "FAILED", couponReserved: true } });
    await prismaA.order.update({ where: { id: outro.id }, data: { couponReserved: true } });
    await Promise.all([liberarCupomReservado(prismaA, pedido.id), liberarCupomReservado(prismaB, pedido.id)]);
    await liberarCupomReservado(prismaA, pedido.id);
    expect((await prismaA.coupon.findUniqueOrThrow({ where: { code: cupom.code } })).usedCount).toBe(1);
    expect((await prismaA.order.findUniqueOrThrow({ where: { id: outro.id } })).couponReserved).toBe(true);
    await liberarCupomReservado(prismaA, outro.id); // pedido pendente não pode perder reserva
    expect((await prismaA.coupon.findUniqueOrThrow({ where: { code: cupom.code } })).usedCount).toBe(1);
  });

  it("falha ao persistir outbox reverte status/estoque; retry grava só um e-mail", async () => {
    const produto = await criarProduto(prismaA, { stock: 5 });
    const pedido = await criarPedido(prismaA, { produtoId: produto.id, itens: [{ quantity: 1 }] });
    enfileirarEmailMock.mockRejectedValueOnce(new Error("outbox indisponível"));
    await expect(finalizarPedidoPago(pedido.id, "rollback", comoBanco(prismaA))).rejects.toThrow("outbox indisponível");
    expect(await prismaA.order.findUniqueOrThrow({ where: { id: pedido.id } })).toMatchObject({ status: "PENDING", paymentStatus: "PENDING" });
    expect((await prismaA.product.findUniqueOrThrow({ where: { id: produto.id } })).stock).toBe(5);
    expect(await prismaA.erpEvent.count({ where: { businessKey: `pedido_pago:${pedido.id}` } })).toBe(0);
    await finalizarPedidoPago(pedido.id, "rollback", comoBanco(prismaA));
    expect(await prismaA.emailOutbox.count({ where: { orderId: pedido.id } })).toBe(1);
  });

  it("aprovação concorrente com cancelamento não devolve reserva de pedido pago", async () => {
    const produto = await criarProduto(prismaA, { stock: 5 });
    const cupom = await prismaA.coupon.create({ data: { code: unico("RACE"), type: "FIXED", value: 1, maxUses: 1, usedCount: 1 } });
    const pedido = await criarPedido(prismaA, { produtoId: produto.id, itens: [{ quantity: 1 }], cupom: cupom.code });
    await prismaA.order.update({ where: { id: pedido.id }, data: { couponReserved: true } });
    await Promise.all([
      finalizarPedidoPago(pedido.id, "approve", comoBanco(prismaA)),
      prismaB.$transaction(async tx => {
        const { count } = await tx.order.updateMany({ where: { id: pedido.id, status: "PENDING", paymentStatus: "PENDING" }, data: { status: "CANCELLED", paymentStatus: "FAILED" } });
        if (count) await liberarCupomReservado(tx, pedido.id);
      }),
    ]);
    const depois = await prismaA.order.findUniqueOrThrow({ where: { id: pedido.id } });
    const contador = (await prismaA.coupon.findUniqueOrThrow({ where: { code: cupom.code } })).usedCount;
    if (depois.status === "PAID") { expect(contador).toBe(1); expect(depois.couponReserved).toBe(true); }
    else { expect(depois).toMatchObject({ status: "CANCELLED", paymentStatus: "PAID", holdCode: "REVISAO_FINANCEIRA", couponReserved: false }); expect(contador).toBe(0); }
  });

  it("hold de estoque preserva reserva, não baixa parcialmente e só libera com comando explícito", async () => {
    const produto = await criarProduto(prismaA, { stock: 0 });
    const pedido = await criarPedido(prismaA, { produtoId: produto.id, itens: [{ quantity: 1 }] });
    expect(await finalizarPedidoPago(pedido.id, "hold-1", comoBanco(prismaA))).toMatchObject({ emEspera: true });
    await prismaA.product.update({ where: { id: produto.id }, data: { stock: 5 } });
    expect(await finalizarPedidoPago(pedido.id, "hold-1", comoBanco(prismaA))).toMatchObject({ emEspera: true });
    expect((await prismaA.product.findUniqueOrThrow({ where: { id: produto.id } })).stock).toBe(5);
    expect(await finalizarPedidoPago(pedido.id, "hold-1", comoBanco(prismaA), true)).toMatchObject({ emEspera: false });
    await finalizarPedidoPago(pedido.id, "hold-1", comoBanco(prismaA), true);
    expect((await prismaA.product.findUniqueOrThrow({ where: { id: produto.id } })).stock).toBe(4);
  });
});

// O número aleatório de 4 dígitos não é o objeto destes testes; evitar colisões entre fixtures.
vi.mock("@/lib/utils", async importOriginal => {
 const original = await importOriginal<typeof import("@/lib/utils")>();
 let sequence = 0;
 return { ...original, orderNumber: () => `DC-TEST-${++sequence}` };
});
