import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const identities = vi.fn();
  const identitiesUpdate = vi.fn();
  const browserUpdate = vi.fn();
  const eventsUpdate = vi.fn();
  const lockEvents = vi.fn();
  const audit = vi.fn();
  const getSession = vi.fn();
  const readConsent = vi.fn();
  const originAllowed = vi.fn();
  const tx = {
    $queryRaw: lockEvents,
    analyticsOrderIdentity: { findMany: identities, updateMany: identitiesUpdate },
    analyticsBrowserConsent: { updateMany: browserUpdate },
    analyticsEvent: { updateMany: eventsUpdate },
    auditLog: { create: audit },
  };
  const transaction = vi.fn(async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx));
  return { identities, identitiesUpdate, browserUpdate, eventsUpdate, lockEvents, audit, getSession, readConsent, originAllowed, transaction };
});
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/ga4-browser-consent", () => ({
  GA4_CONSENT_COOKIE: "dc_ga4_consent",
  newConsentToken: vi.fn(),
  readBrowserConsent: mocks.readConsent,
  sameOriginRequest: mocks.originAllowed,
}));

import { POST } from "@/app/api/analytics/consent/route";

const one = "11111111-1111-4111-8111-111111111111";
const two = "22222222-2222-4222-8222-222222222222";
const tokenA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tokenB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const route = "https://www.divinecloset.com.br/api/analytics/consent";
const req = () => new NextRequest(route, {
  method: "POST",
  headers: { origin: "https://www.divinecloset.com.br", host: "www.divinecloset.com.br", "content-type": "application/json" },
  body: JSON.stringify({ granted: false }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readConsent.mockResolvedValue(null);
  mocks.getSession.mockResolvedValue(null);
  mocks.originAllowed.mockReturnValue(true);
  mocks.identities.mockResolvedValue([]);
  mocks.identitiesUpdate.mockResolvedValue({ count: 0 });
  mocks.browserUpdate.mockResolvedValue({ count: 0 });
  mocks.eventsUpdate.mockResolvedValue({ count: 0 });
  mocks.lockEvents.mockResolvedValue([]);
  mocks.audit.mockResolvedValue({ id: "audit" });
});

describe("GA4 consent: recusa transacional e cross-device dos pedidos", () => {
  it("revoga pedidos da própria conta mesmo sem cookie analítico no dispositivo", async () => {
    mocks.getSession.mockResolvedValue({ role: "CLIENT", sub: "account-owner" });
    mocks.identities.mockResolvedValue([
      { orderId: one, consentTokenId: tokenA },
      { orderId: two, consentTokenId: tokenB },
    ]);
    const response = await POST(req());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.identities).toHaveBeenCalledWith({
      where: { OR: [{ order: { userId: "account-owner" } }] },
      select: { orderId: true, consentTokenId: true },
    });
    expect(mocks.browserUpdate).toHaveBeenCalledWith({
      where: { id: { in: [tokenA, tokenB] }, state: { not: "REVOKED" } },
      data: { state: "REVOKED", revokedAt: expect.any(Date) },
    });
    expect(mocks.identitiesUpdate).toHaveBeenCalledWith({
      where: { orderId: { in: [one, two] } },
      data: { consentState: "REVOKED", clientId: null, revokedAt: expect.any(Date) },
    });
    expect(mocks.lockEvents).toHaveBeenCalledTimes(1);
    expect(mocks.eventsUpdate).toHaveBeenCalledWith({
      where: { orderId: { in: [one, two] }, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "SKIPPED", leaseUntil: null, lastError: "consent_revoked" },
    });
    expect(mocks.eventsUpdate).toHaveBeenCalledWith({
      where: { orderId: { in: [one, two] }, status: "PROCESSING" },
      data: { status: "FAILED", leaseUntil: null, lastError: "consent_revoked_inflight_uncertain" },
    });
    expect(mocks.audit).toHaveBeenCalledWith({
      data: {
        action: "ga4_consent_revoked",
        entity: "AccountAnalyticsConsent",
        entityId: "account-owner",
        meta: { revoked: true, affectedOrders: 2, source: "account_and_browser" },
      },
    });
  });

  it("sem sessão e sem cookie não consulta nem altera a base", async () => {
    const response = await POST(req());
    expect(response.status).toBe(200);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.lockEvents).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("conta de staff sem cookie não pode revogar pedidos de cliente", async () => {
    mocks.getSession.mockResolvedValue({ role: "ADMIN", sub: "staff" });
    const response = await POST(req());
    expect(response.status).toBe(200);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("cookie autenticado do navegador revoga token mesmo sem login", async () => {
    mocks.readConsent.mockResolvedValue({ tokenId: tokenA, granted: true });
    mocks.identities.mockResolvedValue([{ orderId: one, consentTokenId: tokenA }]);
    const response = await POST(req());
    expect(response.status).toBe(200);
    expect(mocks.identities).toHaveBeenCalledWith({
      where: { OR: [{ consentTokenId: tokenA }] },
      select: { orderId: true, consentTokenId: true },
    });
    expect(mocks.eventsUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenCalledWith({
      data: {
        action: "ga4_consent_revoked",
        entity: "AnalyticsBrowserConsent",
        entityId: tokenA,
        meta: { revoked: true, affectedOrders: 1, source: "browser" },
      },
    });
  });

  it("não confia em origens externas e não executa transação", async () => {
    mocks.originAllowed.mockReturnValue(false);
    expect((await POST(req())).status).toBe(403);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("mantém dedupe de IDs de pedidos quando conta e cookie apontam ao mesmo registro", async () => {
    mocks.readConsent.mockResolvedValue({ tokenId: tokenA, granted: true });
    mocks.getSession.mockResolvedValue({ role: "CLIENT", sub: "account-owner" });
    mocks.identities.mockResolvedValue([
      { orderId: one, consentTokenId: tokenA },
      { orderId: one, consentTokenId: tokenA },
    ]);
    const response = await POST(req());
    expect(response.status).toBe(200);
    expect(mocks.identitiesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: { in: [one] } } }),
    );
  });
});
