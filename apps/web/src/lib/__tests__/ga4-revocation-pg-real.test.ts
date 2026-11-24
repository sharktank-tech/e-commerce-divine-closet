import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Integração limitada a Postgres DESCARTÁVEL local de CI. Não executa
// em bancos remotos, previews ou produção, mesmo se DATABASE_URL existir.
const localDisposable = process.env.GA4_CONCURRENCY_TEST_DB === "true" &&
  /^postgres(?:ql)?:\/\/[^/]+@(?:localhost|127\.0\.0\.1):5432\/divine_ga4_test(?:\?|$)/.test(
    process.env.DATABASE_URL ?? "",
  );

const mocked = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("@/lib/ga4-transport", () => ({ submitGa4Refund: mocked.submit }));

import { prisma } from "@/lib/prisma";
import { newConsentToken, GA4_CONSENT_COOKIE } from "@/lib/ga4-browser-consent";
import { POST } from "@/app/api/analytics/consent/route";
import { processOneGa4Refund } from "@/lib/ga4-refund-worker";
import { enqueueGa4RefundIfAuthorized } from "@/lib/ga4-refund-outbox";

const originalFlag = process.env.GA4_REFUND_TRANSPORT_ENABLED;
afterEach(() => {
  mocked.submit.mockReset();
  if (originalFlag === undefined) delete process.env.GA4_REFUND_TRANSPORT_ENABLED;
  else process.env.GA4_REFUND_TRANSPORT_ENABLED = originalFlag;
});

describe.skipIf(!localDisposable)("GA4 concorrência: revogação vs worker em PostgreSQL real descartável", () => {
  it("revogação em PROCESSING permanece FAILED após finalização CAS de transporte simulado", async () => {
    const { token, tokenId } = await newConsentToken();
    const testId = randomUUID();
    let orderId: string | undefined;
    let release!: (result: { kind: "DISABLED" }) => void;
    let entered!: () => void;
    const inTransport = new Promise<void>((resolve) => { entered = resolve; });
    const simulatedTransport = new Promise<{ kind: "DISABLED" }>((resolve) => { release = resolve; });
    mocked.submit.mockImplementationOnce(() => { entered(); return simulatedTransport; });
    process.env.GA4_REFUND_TRANSPORT_ENABLED = "true"; // Transporte mockado, sem HTTP.

    try {
      const order = await prisma.order.create({
        data: {
          number: "GA4-TEST-" + testId,
          status: "REFUNDED",
          paymentStatus: "REFUNDED",
          subtotal: 100, total: 100,
        },
      });
      orderId = order.id;
      await prisma.refund.create({
        data: { orderId, paymentId: "ga4-local-test", idempotencyKey: "ga4-local-" + testId, amount: 100, status: "APPROVED" },
      });
      await prisma.analyticsBrowserConsent.create({
        data: { id: tokenId, state: "GRANTED", grantedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) },
      });
      await prisma.analyticsOrderIdentity.create({
        data: { orderId, consentTokenId: tokenId, clientId: "123456.789012", consentState: "GRANTED", consentProofAt: new Date() },
      });
      const event = await prisma.analyticsEvent.create({
        data: {
          orderId, dedupeKey: "ga4:test:" + testId, eventType: "refund", status: "PENDING",
          payload: { transaction_id: orderId, currency: "BRL", value: 100, shipping: 0, items: [] },
        },
      });
      const worker = processOneGa4Refund();
      await Promise.race([inTransport, new Promise((_, reject) => setTimeout(() => reject(new Error("worker_not_entered")), 8000))]);
      const processing = await prisma.analyticsEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(processing.status).toBe("PROCESSING");

      const request = new NextRequest("http://localhost:3000/api/analytics/consent", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          host: "localhost:3000",
          cookie: GA4_CONSENT_COOKIE + "=" + token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ granted: false }),
      });
      const response = await POST(request);
      expect(response.status).toBe(200);
      const revoked = await prisma.analyticsEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(revoked.status).toBe("FAILED");
      expect(revoked.lastError).toBe("consent_revoked_inflight_uncertain");
      expect(revoked.leaseUntil).toBeNull();

      release({ kind: "DISABLED" });
      expect(await worker).toBe("CONFLICT");
      const final = await prisma.analyticsEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(final.status).toBe("FAILED");
      expect(final.lastError).toBe("consent_revoked_inflight_uncertain");
      const identity = await prisma.analyticsOrderIdentity.findUniqueOrThrow({ where: { orderId } });
      expect(identity.clientId).toBeNull();
      expect(identity.consentState).toBe("REVOKED");
      const consent = await prisma.analyticsBrowserConsent.findUniqueOrThrow({ where: { id: tokenId } });
      expect(consent.state).toBe("REVOKED");
      expect(mocked.submit).toHaveBeenCalledTimes(1); // Mock local, nenhum HTTP.
    } finally {
      // Não deixar o worker pendurado em caso de assert antecipado.
      release({ kind: "DISABLED" });
      if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
      await prisma.auditLog.deleteMany({ where: { entityId: tokenId, action: "ga4_consent_revoked" } });
      await prisma.analyticsBrowserConsent.deleteMany({ where: { id: tokenId } });
    }
  }, 20_000);

  it("enqueue concorrente com revogação não deixa PENDING após commit", async () => {
    const { token, tokenId } = await newConsentToken();
    const testId = randomUUID();
    let orderId: string | undefined;
    try {
      const order = await prisma.order.create({
        data: { number: "GA4-RACE-" + testId, status: "REFUNDED", paymentStatus: "REFUNDED", subtotal: 100, total: 100 },
      });
      orderId = order.id;
      await prisma.refund.create({
        data: { orderId, paymentId: "ga4-local-test", idempotencyKey: "ga4-race-" + testId, amount: 100, status: "APPROVED" },
      });
      await prisma.analyticsBrowserConsent.create({
        data: { id: tokenId, state: "GRANTED", grantedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) },
      });
      await prisma.analyticsOrderIdentity.create({
        data: { orderId, consentTokenId: tokenId, clientId: "123456.789012", consentState: "GRANTED", consentProofAt: new Date() },
      });
      const request = new NextRequest("http://localhost:3000/api/analytics/consent", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000", host: "localhost:3000",
          cookie: GA4_CONSENT_COOKIE + "=" + token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ granted: false }),
      });
      const [enqueued, revoked] = await Promise.all([
        enqueueGa4RefundIfAuthorized(orderId),
        POST(request),
      ]);
      expect(["CREATED", "SKIPPED"]).toContain(enqueued);
      expect(revoked.status).toBe(200);
      const remaining = await prisma.analyticsEvent.findMany({ where: { orderId } });
      expect(remaining.every((event) => event.status === "SKIPPED")).toBe(true);
      expect(remaining.some((event) => event.status === "PENDING")).toBe(false);
      const identity = await prisma.analyticsOrderIdentity.findUniqueOrThrow({ where: { orderId } });
      expect(identity.consentState).toBe("REVOKED");
      expect((await prisma.analyticsBrowserConsent.findUniqueOrThrow({ where: { id: tokenId } })).state).toBe("REVOKED");
      // Após a revogação, nenhuma nova intenção pode ser criada.
      expect(await enqueueGa4RefundIfAuthorized(orderId)).toBe("SKIPPED");
    } finally {
      if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
      await prisma.auditLog.deleteMany({ where: { entityId: tokenId, action: "ga4_consent_revoked" } });
      await prisma.analyticsBrowserConsent.deleteMany({ where: { id: tokenId } });
    }
  }, 20_000);

});
