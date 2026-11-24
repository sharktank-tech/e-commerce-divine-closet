import { describe, expect, it, vi } from "vitest";
const { identityUpdate, eventUpdate, transaction, orderFind, lockEvents } = vi.hoisted(() => {
  const identityUpdate = vi.fn();
  const eventUpdate = vi.fn();
  const orderFind = vi.fn();
  const lockEvents = vi.fn().mockResolvedValue([]);
  const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
    cb({
      $queryRaw: lockEvents,
      analyticsOrderIdentity: { updateMany: identityUpdate },
      analyticsEvent: { updateMany: eventUpdate },
    }),
  );
  return { identityUpdate, eventUpdate, orderFind, transaction, lockEvents };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transaction,
    order: { findUnique: orderFind },
  },
}));
import { revokeOrderAnalyticsConsent } from "../ga4-consent-revoke";

describe("GA4 consentimento: revogação transacional", () => {
  it("revoga identificação e cancela intenções pendentes", async () => {
    identityUpdate.mockResolvedValueOnce({ count: 1 });
    eventUpdate.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });
    expect(await revokeOrderAnalyticsConsent("order")).toEqual({ revoked: true, skipped: 2, inFlightQuarantined: 1 });
    expect(lockEvents).toHaveBeenCalledTimes(1);
    expect(identityUpdate).toHaveBeenCalledWith({
      where: { orderId: "order", consentState: { not: "REVOKED" } },
      data: {
        consentState: "REVOKED",
        clientId: null,
        revokedAt: expect.any(Date),
      },
    });
    expect(eventUpdate).toHaveBeenCalledWith({
      where: { orderId: "order", status: { in: ["PENDING", "FAILED"] } },
      data: { status: "SKIPPED", leaseUntil: null, lastError: "consent_revoked" },
    });
    expect(eventUpdate).toHaveBeenCalledWith({
      where: { orderId: "order", status: "PROCESSING" },
      data: { status: "FAILED", leaseUntil: null, lastError: "consent_revoked_inflight_uncertain" },
    });
  });
  it("não engole falha no banco de dados", async () => {
    identityUpdate.mockRejectedValueOnce(new Error("unavailable"));
    await expect(revokeOrderAnalyticsConsent("order")).rejects.toThrow("unavailable");
  });
  it("bloqueia revogação por usuário não autorizado", async () => {
    orderFind.mockResolvedValueOnce({ userId: "other-user", guestEmail: null });
    await expect(revokeOrderAnalyticsConsent("order", "requester-user")).rejects.toThrow("unauthorized");
  });
  it("permite revogação por proprietário", async () => {
    orderFind.mockResolvedValueOnce({ userId: "owner-user", guestEmail: null });
    identityUpdate.mockResolvedValueOnce({ count: 1 });
    eventUpdate.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    const result = await revokeOrderAnalyticsConsent("order", "owner-user");
    expect(result.revoked).toBe(true);
  });
  it("bloqueia revogação de pedido inexistente", async () => {
    orderFind.mockResolvedValueOnce(null);
    await expect(revokeOrderAnalyticsConsent("order", "requester-user")).rejects.toThrow("order_not_found");
  });
});
