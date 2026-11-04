import { describe, expect, it, vi } from "vitest";
const { identityUpdate, eventUpdate, transaction } = vi.hoisted(() => {
  const identityUpdate = vi.fn();
  const eventUpdate = vi.fn();
  const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
    cb({
      analyticsOrderIdentity: { updateMany: identityUpdate },
      analyticsEvent: { updateMany: eventUpdate },
    }),
  );
  return { identityUpdate, eventUpdate, transaction };
});
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));
import { revokeOrderAnalyticsConsent } from "../ga4-consent-revoke";

describe("GA4 consentimento: revogação transacional", () => {
  it("revoga identificação e cancela intenções pendentes", async () => {
    identityUpdate.mockResolvedValueOnce({ count: 1 });
    eventUpdate.mockResolvedValueOnce({ count: 2 });
    expect(await revokeOrderAnalyticsConsent("order")).toEqual({ revoked: true, skipped: 2 });
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
      data: { status: "SKIPPED", lastError: "consent_revoked" },
    });
  });
  it("não engole falha no banco de dados", async () => {
    identityUpdate.mockRejectedValueOnce(new Error("unavailable"));
    await expect(revokeOrderAnalyticsConsent("order")).rejects.toThrow("unavailable");
  });
});
