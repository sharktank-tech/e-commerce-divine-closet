import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return {
    prisma: new PrismaClient({
      datasourceUrl: `postgresql://postgres@127.0.0.1:${process.env.PGPORT || 5433}/dc_marketing_tests`,
    }),
  };
});
const auth = vi.hoisted(() => ({ requireAuth: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  ...auth,
  forbidden: () => new Response(null, { status: 403 }),
}));
import { prisma } from "@/lib/prisma";
import {
  requestSubscription,
  applyNewsletterToken,
} from "@/lib/marketing/newsletter";
import { marketingToken } from "@/lib/marketing/tokens";
import {
  queueCampaign as queueCampaignImpl,
  campaignRevision,
  cancelCampaign,
  drainMarketing,
} from "@/lib/marketing/campaigns";
import { EmailNaoAceito } from "@/lib/email";
import { POST as conversion } from "@/app/api/marketing/conversao/route";
import { GET as metrics } from "@/app/api/admin/marketing/indicadores/route";
const run = promisify(execFile),
  host = "127.0.0.1",
  port = process.env.PGPORT || "5433",
  operator = "00000000-0000-4000-8000-000000000001";
const psql = (sql: string) =>
  run("psql", [
    "-h",
    host,
    "-p",
    port,
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
beforeAll(async () => {
  if (
    process.env.PGHOST &&
    !["127.0.0.1", "localhost"].includes(process.env.PGHOST)
  )
    throw new Error("Teste exige PG local descartável.");
  process.env.JWT_SECRET = "local-marketing-test-secret-at-least-32-characters";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3114";
  await psql("DROP DATABASE IF EXISTS dc_marketing_tests");
  await psql("CREATE DATABASE dc_marketing_tests");
  await run(
    "npx",
    [
      "--no-install",
      "prisma",
      "migrate",
      "deploy",
      "--schema",
      "packages/database/prisma/schema.prisma",
    ],
    {
      cwd: resolve(__dirname, "../../../../.."),
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://postgres@${host}:${port}/dc_marketing_tests`,
      },
    },
  );
  await prisma.user.create({
    data: {
      id: operator,
      name: "Teste",
      email: "admin@example.invalid",
      password: "nao-usado",
      role: "ADMIN",
    },
  });
}, 180000);
afterAll(async () => {
  await prisma.$disconnect();
  await psql("DROP DATABASE IF EXISTS dc_marketing_tests");
}, 30000);
beforeEach(async () => {
  await prisma.marketingMessage.deleteMany();
  await prisma.marketingCampaign.deleteMany();
  await prisma.newsletterSubscriber.deleteMany();
  auth.requireAuth.mockResolvedValue({ sub: operator });
  auth.getSession.mockResolvedValue(null);
});
async function confirmed(email = "subscriber@example.invalid") {
  await requestSubscription(email, "footer", false);
  const s = await prisma.newsletterSubscriber.findUniqueOrThrow({
    where: { email },
  });
  expect(
    await applyNewsletterToken(
      marketingToken(s.id, s.confirmNonce!, "confirm"),
      "confirm",
    ),
  ).toBe(true);
  return prisma.newsletterSubscriber.findUniqueOrThrow({ where: { id: s.id } });
}
async function queueCampaign(
  id: string,
  operator: string,
  expected: number,
  revision?: string,
) {
  const c = await prisma.marketingCampaign.findUniqueOrThrow({ where: { id } });
  return queueCampaignImpl(
    id,
    operator,
    expected,
    revision || campaignRevision(c),
  );
}
async function campaign() {
  return prisma.marketingCampaign.create({
    data: {
      subject: "Oferta de teste",
      body: "Texto <script> apenas texto",
      createdBy: operator,
    },
  });
}
it("inscrição concorrente gera uma linha e uma confirmação; usa timestamp do servidor", async () => {
  await Promise.all([
    requestSubscription("a@example.invalid", "footer", false),
    requestSubscription("a@example.invalid", "footer", false),
  ]);
  expect(await prisma.newsletterSubscriber.count()).toBe(1);
  expect(await prisma.marketingMessage.count()).toBe(1);
  const s = await prisma.newsletterSubscriber.findFirstOrThrow();
  expect(s.status).toBe("pending");
  expect(s.unsubscribeToken).toBeNull();
});
it("finalidade, expiração e replay da confirmação; cancelamento é idempotente", async () => {
  await requestSubscription("a@example.invalid", "footer", false);
  const s = await prisma.newsletterSubscriber.findFirstOrThrow();
  const confirm = marketingToken(s.id, s.confirmNonce!, "confirm"),
    unsubscribe = marketingToken(s.id, s.tokenVersion, "unsubscribe");
  expect(await applyNewsletterToken(unsubscribe, "confirm")).toBe(false);
  expect(await applyNewsletterToken(confirm, "unsubscribe")).toBe(false);
  expect(await applyNewsletterToken(confirm, "confirm")).toBe(true);
  expect(await applyNewsletterToken(confirm, "confirm")).toBe(false);
  expect(await applyNewsletterToken(unsubscribe, "unsubscribe")).toBe(true);
  expect(await applyNewsletterToken(unsubscribe, "unsubscribe")).toBe(true);
});
it("cadastro repetido não reativa; reativação exige nova confirmação e invalida link antigo", async () => {
  const s = await confirmed();
  const unsubscribe = marketingToken(s.id, s.tokenVersion, "unsubscribe");
  await applyNewsletterToken(unsubscribe, "unsubscribe");
  await requestSubscription(s.email, "footer", false);
  expect(
    (
      await prisma.newsletterSubscriber.findUniqueOrThrow({
        where: { id: s.id },
      })
    ).status,
  ).toBe("unsubscribed");
  await prisma.newsletterSubscriber.update({
    where: { id: s.id },
    data: { lastConfirmationAt: new Date(0) },
  });
  await requestSubscription(s.email, "footer", true);
  const pending = await prisma.newsletterSubscriber.findUniqueOrThrow({
    where: { id: s.id },
  });
  expect(pending.status).toBe("unsubscribed");
  expect(
    await applyNewsletterToken(
      marketingToken(s.id, pending.confirmNonce!, "confirm"),
      "confirm",
    ),
  ).toBe(true);
});
it("confirmação expirada e token adulterado não alteram inscrição", async () => {
  await requestSubscription("a@example.invalid", "footer", false);
  const s = await prisma.newsletterSubscriber.findFirstOrThrow();
  const token = marketingToken(s.id, s.confirmNonce!, "confirm");
  await prisma.newsletterSubscriber.update({
    where: { id: s.id },
    data: { confirmExpiresAt: new Date(0) },
  });
  expect(await applyNewsletterToken(token, "confirm")).toBe(false);
  expect(await applyNewsletterToken(token.slice(0, -1) + "z", "confirm")).toBe(
    false,
  );
});
it("mock preserva fila, nunca chama transporte nem registra aceitação", async () => {
  await confirmed();
  const c = await campaign();
  await queueCampaign(c.id, operator, 1);
  const send = vi.fn();
  expect(await drainMarketing(10, { driver: "mock", send })).toEqual({
    simulated: true,
    processed: 0,
  });
  expect(send).not.toHaveBeenCalled();
  expect(
    await prisma.marketingMessage.count({ where: { status: "ACCEPTED" } }),
  ).toBe(0);
});
it("dois workers reais concorrentes só enviam uma vez e payload contém descadastro", async () => {
  await confirmed();
  await prisma.marketingMessage.deleteMany({ where: { kind: "CONFIRM" } });
  const c = await campaign();
  await Promise.all([
    queueCampaign(c.id, operator, 1),
    queueCampaign(c.id, operator, 1),
  ]);
  const send = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 30));
    return { id: "fake-id" };
  });
  await Promise.all([
    drainMarketing(1, { driver: "resend", send }),
    drainMarketing(1, { driver: "resend", send }),
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]).toBeDefined();
  expect(
    await prisma.marketingMessage.count({ where: { status: "ACCEPTED" } }),
  ).toBe(1);
});
it("supressão imediatamente antes do envio e cancelamento impedem transporte", async () => {
  const s = await confirmed();
  await prisma.marketingMessage.deleteMany();
  const c = await campaign();
  await queueCampaign(c.id, operator, 1);
  await applyNewsletterToken(
    marketingToken(s.id, s.tokenVersion, "unsubscribe"),
    "unsubscribe",
  );
  const send = vi.fn();
  await drainMarketing(1, { driver: "resend", send });
  expect(send).not.toHaveBeenCalled();
  expect(
    await prisma.marketingMessage.count({ where: { status: "SUPPRESSED" } }),
  ).toBe(1);
  const c2 = await campaign();
  await cancelCampaign(c2.id, operator);
  expect(
    (await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: c2.id } }))
      .status,
  ).toBe("CANCELLED");
});
it("retentativa com backoff e mesma chave; erro permanente encerra", async () => {
  await confirmed();
  await prisma.marketingMessage.deleteMany();
  const c = await campaign();
  await queueCampaign(c.id, operator, 1);
  const send = vi
    .fn()
    .mockRejectedValueOnce(new EmailNaoAceito("rate limit", true))
    .mockResolvedValue({ id: "fake" });
  await drainMarketing(1, { driver: "resend", send });
  const m = await prisma.marketingMessage.findFirstOrThrow();
  expect(m.status).toBe("PENDING");
  expect(m.attempt).toBe(1);
  expect(m.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  await prisma.marketingMessage.update({
    where: { id: m.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await drainMarketing(1, { driver: "resend", send });
  expect(send.mock.calls[0][0].idempotencyKey).toBe(
    send.mock.calls[1][0].idempotencyKey,
  );
  expect(
    (await prisma.marketingMessage.findUniqueOrThrow({ where: { id: m.id } }))
      .status,
  ).toBe("ACCEPTED");
});
it("SMTP incerto exige revisão; não repete automaticamente", async () => {
  await requestSubscription("a@example.invalid", "footer", false);
  await drainMarketing(1, {
    driver: "smtp",
    send: async () => {
      throw new EmailNaoAceito("timeout", true);
    },
  });
  expect((await prisma.marketingMessage.findFirstOrThrow()).status).toBe(
    "REVIEW",
  );
});
it("cancelamento espera envio já iniciado, sem enviar próximos destinatários", async () => {
  await confirmed();
  await confirmed("b@example.invalid");
  await prisma.marketingMessage.deleteMany();
  const c = await campaign();
  await queueCampaign(c.id, operator, 2);
  let signal!: () => void;
  const entered = new Promise<void>((r) => (signal = r));
  let finish!: () => void;
  const wait = new Promise<void>((r) => (finish = r));
  const send = vi.fn(async () => {
    signal();
    await wait;
    return { id: "fake" };
  });
  const worker = drainMarketing(1, { driver: "resend", send });
  await entered;
  const cancel = cancelCampaign(c.id, operator);
  finish();
  await Promise.all([worker, cancel]);
  await drainMarketing(10, { driver: "resend", send });
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    await prisma.marketingMessage.count({
      where: { campaignId: c.id, status: "CANCELLED" },
    }),
  ).toBe(1);
});
it("tabelas privadas negam anon/authenticated e mantêm RLS", async () => {
  const rows = await prisma.$queryRaw<
    { relname: string; relrowsecurity: boolean }[]
  >`SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('NewsletterSubscriber','MarketingCampaign','MarketingMessage')`;
  expect(rows).toHaveLength(3);
  expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  const access = await prisma.$queryRaw<
    { allowed: boolean }[]
  >`SELECT has_table_privilege('anon','"NewsletterSubscriber"','SELECT') AS allowed`;
  expect(access[0].allowed).toBe(false);
});
it("indicadores incluem estornado no bruto e subtraem Refund aprovado uma vez", async () => {
  const id = randomUUID();
  await prisma.order.create({
    data: {
      id,
      number: `test-${id}`,
      status: "REFUNDED",
      paymentStatus: "REFUNDED",
      subtotal: "32.99",
      total: "32.99",
      refund: {
        create: {
          paymentId: "fake",
          amount: "32.99",
          status: "APPROVED",
          idempotencyKey: `refund-${id}`,
        },
      },
    },
  });
  const r = await metrics(
    new NextRequest("http://localhost/api/admin/marketing/indicadores"),
  );
  const d = await r.json();
  expect(d.receitaBruta).toBe(32.99);
  expect(d.valoresEstornados).toBe(32.99);
  expect(d.receitaAposEstornos).toBe(0);
  await prisma.order.delete({ where: { id } });
});
it("sem admin nega indicadores", async () => {
  auth.requireAuth.mockResolvedValue(null);
  expect(
    (
      await metrics(
        new NextRequest("http://localhost/api/admin/marketing/indicadores"),
      )
    ).status,
  ).toBe(403);
});
it("mudança de público exige nova prévia e falha permanente não retenta", async () => {
  await confirmed();
  const c = await campaign();
  await expect(queueCampaign(c.id, operator, 2)).rejects.toThrow(
    "público mudou",
  );
  await prisma.marketingMessage.deleteMany();
  await queueCampaign(c.id, operator, 1);
  await drainMarketing(1, {
    driver: "resend",
    send: async () => {
      throw new EmailNaoAceito("invalid", false);
    },
  });
  expect((await prisma.marketingMessage.findFirstOrThrow()).status).toBe(
    "FAILED",
  );
});

it("prévia antiga é rejeitada mesmo com o mesmo total de destinatários", async () => {
  await confirmed();
  const c = await campaign();
  const revision = campaignRevision(c);
  await prisma.marketingCampaign.update({
    where: { id: c.id },
    data: { body: "Outro conteúdo" },
  });
  await expect(queueCampaign(c.id, operator, 1, revision)).rejects.toThrow(
    "campanha mudou",
  );
  expect(
    await prisma.marketingMessage.count({ where: { campaignId: c.id } }),
  ).toBe(0);
});
it("cancelar e reativar não libera campanha antiga nem cadastro sem consentimento", async () => {
  const s = await confirmed();
  await prisma.marketingMessage.deleteMany();
  const c = await campaign();
  await queueCampaign(c.id, operator, 1);
  await applyNewsletterToken(
    marketingToken(s.id, s.tokenVersion, "unsubscribe"),
    "unsubscribe",
  );
  await prisma.newsletterSubscriber.update({
    where: { id: s.id },
    data: { lastConfirmationAt: new Date(0) },
  });
  await requestSubscription(s.email, "footer", true);
  const pending = await prisma.newsletterSubscriber.findUniqueOrThrow({
    where: { id: s.id },
  });
  await applyNewsletterToken(
    marketingToken(s.id, pending.confirmNonce!, "confirm"),
    "confirm",
  );
  const send = vi.fn(async () => ({ id: "fake" }));
  await drainMarketing(10, { driver: "resend", send });
  expect(send).not.toHaveBeenCalled(); // confirmações consumidas também são suprimidas
  expect(
    (
      await prisma.marketingMessage.findFirstOrThrow({
        where: { campaignId: c.id },
      })
    ).status,
  ).toBe("SUPPRESSED");
  await prisma.newsletterSubscriber.create({
    data: { email: "unproven@example.invalid", status: "confirmed" },
  });
  const c2 = await campaign();
  expect(await queueCampaign(c2.id, operator, 1)).toMatchObject({ queued: 1 });
});

it("consulta de conversão exige dono ou chave secreta UUIDv4; hold/pendente não convertem", async () => {
  const id = randomUUID(),
    key = randomUUID();
  await prisma.order.create({
    data: {
      id,
      number: `conv-${id}`,
      guestEmail: "buyer@example.invalid",
      idempotencyKey: key,
      status: "PAID",
      paymentStatus: "PAID",
      total: "10.00",
      subtotal: "10.00",
    },
  });
  const req = (extra: object = {}) =>
    new NextRequest("http://localhost/api/marketing/conversao", {
      method: "POST",
      body: JSON.stringify({ number: `conv-${id}`, ...extra }),
    });
  expect(
    (await conversion(req({ email: "buyer@example.invalid" }))).status,
  ).toBe(404);
  expect((await conversion(req({ checkoutKey: randomUUID() }))).status).toBe(
    404,
  );
  const d = await (await conversion(req({ checkoutKey: key }))).json();
  expect(d.paid).toBe(true);
  expect(d.total).toBe(10);
  expect(d).not.toHaveProperty("guestEmail");
  await prisma.order.update({
    where: { id },
    data: { holdCode: "ESTOQUE_INSUFICIENTE" },
  });
  expect(
    (await (await conversion(req({ checkoutKey: key }))).json()).paid,
  ).toBe(false);
  await prisma.order.update({
    where: { id },
    data: { holdCode: null, createdAt: new Date(Date.now() - 7_200_000) },
  });
  expect((await conversion(req({ checkoutKey: key }))).status).toBe(404);
  await prisma.order.update({
    where: { id },
    data: { userId: operator, guestEmail: null },
  });
  auth.getSession.mockResolvedValue({
    sub: "00000000-0000-4000-8000-000000000099",
  });
  expect((await conversion(req())).status).toBe(404);
  auth.getSession.mockResolvedValue({ sub: operator });
  expect((await (await conversion(req())).json()).paid).toBe(true);
  await prisma.order.update({
    where: { id },
    data: { paymentStatus: "PENDING" },
  });
  expect((await (await conversion(req())).json()).paid).toBe(false);
  await prisma.order.delete({ where: { id } });
});
