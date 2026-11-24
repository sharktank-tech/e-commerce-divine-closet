import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  browserCount: vi.fn(),
  identityCount: vi.fn(),
  eventCount: vi.fn(),
  auditCount: vi.fn(),
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    analyticsBrowserConsent: { count: mocks.browserCount },
    analyticsOrderIdentity: { count: mocks.identityCount },
    analyticsEvent: { count: mocks.eventCount },
    auditLog: { count: mocks.auditCount },
  },
}));
import { previewGa4Retention } from "../ga4-retention-inventory";

const now = new Date("2026-11-24T12:00:00.000Z");
const cutoffs = {
  browserBefore: new Date("2026-08-01T00:00:00.000Z"),
  identityBefore: new Date("2026-08-01T00:00:00.000Z"),
  terminalEventBefore: new Date("2026-05-01T00:00:00.000Z"),
  auditBefore: new Date("2025-11-01T00:00:00.000Z"),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.browserCount.mockResolvedValue(4);
  mocks.identityCount.mockResolvedValue(2);
  mocks.auditCount.mockResolvedValue(1);
  mocks.eventCount.mockResolvedValueOnce(8).mockResolvedValueOnce(3).mockResolvedValueOnce(5);
});

describe("GA4 retenção: preview exclusivamente read-only", () => {
  it("contabiliza candidatos sem retornar identificadores nem excluir registros", async () => {
    const report = await previewGa4Retention(cutoffs, now);
    expect(report).toEqual({
      dryRun: true,
      candidates: { browserConsents: 4, revokedIdentities: 2, terminalEvents: 8, consentAuditLogs: 1 },
      manualReview: { processing: 3, failed: 5 },
    });
    expect(mocks.browserCount).toHaveBeenCalledWith({
      where: { OR: [
        { state: "REVOKED", revokedAt: { lte: cutoffs.browserBefore } },
        { expiresAt: { lte: cutoffs.browserBefore } },
      ] },
    });
    expect(mocks.identityCount).toHaveBeenCalledWith({
      where: { consentState: "REVOKED", revokedAt: { lte: cutoffs.identityBefore } },
    });
    expect(mocks.eventCount).toHaveBeenCalledWith({
      where: { status: { in: ["SKIPPED", "ACCEPTED"] }, updatedAt: { lte: cutoffs.terminalEventBefore } },
    });
    expect(mocks.eventCount).toHaveBeenCalledWith({ where: { status: "PROCESSING" } });
    expect(mocks.eventCount).toHaveBeenCalledWith({ where: { status: "FAILED" } });
    expect(mocks.auditCount).toHaveBeenCalledWith({
      where: {
        action: { in: ["ga4_consent_granted", "ga4_consent_revoked"] },
        createdAt: { lte: cutoffs.auditBefore },
      },
    });
    expect(JSON.stringify(report)).not.toContain("clientId");
    expect(JSON.stringify(report)).not.toContain("orderId");
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("não confunde FAILED ou PROCESSING com candidatos à exclusão automática", async () => {
    const result = await previewGa4Retention(cutoffs, now);
    expect(result.manualReview.failed).toBe(5);
    expect(result.manualReview.processing).toBe(3);
    expect(result.candidates.terminalEvents).toBe(8);
  });

  it("nega datas inválidas e cutoffs futuros antes de consultar o banco", async () => {
    await expect(previewGa4Retention(cutoffs, new Date("invalid"))).rejects.toThrow("invalid_retention_now");
    await expect(previewGa4Retention({ ...cutoffs, browserBefore: new Date("invalid") }, now)).rejects.toThrow("invalid_retention_cutoff");
    await expect(previewGa4Retention({ ...cutoffs, auditBefore: new Date("2030-01-01") }, now)).rejects.toThrow("invalid_retention_cutoff");
    expect(mocks.browserCount).not.toHaveBeenCalled();
    expect(mocks.eventCount).not.toHaveBeenCalled();
  });
});
