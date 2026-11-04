import { beforeEach, describe, expect, it, vi } from "vitest";

const { findEvent, updateEvent, findBrowser, findFull, send } = vi.hoisted(() => ({
  findEvent: vi.fn(), updateEvent: vi.fn(), findBrowser: vi.fn(),
  findFull: vi.fn(), send: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    analyticsEvent: { findFirst: findEvent, updateMany: updateEvent, findUnique: findFull },
    analyticsBrowserConsent: { findUnique: findBrowser },
  },
}));
vi.mock("@/lib/ga4-transport", () => ({ submitGa4Refund: send }));
import { processOneGa4Refund } from "../ga4-refund-worker";

const id = "6fda65c2-7a90-4f18-88e8-1878f5a4c5de";
const validOrder = {
  id, paymentStatus: "REFUNDED",
  refund: { status: "APPROVED" },
  analyticsIdentity: {
    clientId: "123456.789012", consentState: "GRANTED",
    consentProofAt: new Date("2026-11-04"), revokedAt: null,
    consentTokenId: "39a1be2b-983c-4d03-98ba-c25ac36c99fb",
  },
};
const validEvent = {
  id: "event", order: validOrder,
  payload: { transaction_id: id, currency: "BRL", value: 25, shipping: 0, items: [] },
};

describe("GA4 refund worker: hard-off, concorrência e revogação", () => {
  const env = process.env.GA4_REFUND_TRANSPORT_ENABLED;
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.GA4_REFUND_TRANSPORT_ENABLED = "true";
    findEvent.mockResolvedValue({ id: "event" });
    updateEvent.mockResolvedValue({ count: 1 });
    findFull.mockResolvedValue(validEvent);
    findBrowser.mockResolvedValue({ state: "GRANTED", revokedAt: null, expiresAt: new Date("2030-01-01") });
    send.mockResolvedValue({ kind: "DISABLED" });
  });
  it("não acessa banco ou rede quando flag está off", async () => {
    delete process.env.GA4_REFUND_TRANSPORT_ENABLED;
    expect(await processOneGa4Refund()).toBe("DISABLED");
    expect(findEvent).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("não entrega se outra execução reivindicou o evento", async () => {
    updateEvent.mockResolvedValueOnce({ count: 0 });
    expect(await processOneGa4Refund()).toBe("EMPTY");
    expect(send).not.toHaveBeenCalled();
  });
  it("bloqueia a entrega após revogação persistida", async () => {
    findBrowser.mockResolvedValueOnce({ state: "REVOKED", revokedAt: new Date(), expiresAt: new Date("2030-01-01") });
    expect(await processOneGa4Refund()).toBe("SKIPPED");
    expect(send).not.toHaveBeenCalled();
  });
  it("não envia quando pagamento ainda não é estornado", async () => {
    findFull.mockResolvedValueOnce({ ...validEvent, order: { ...validOrder, paymentStatus: "PAID" } });
    expect(await processOneGa4Refund()).toBe("SKIPPED");
    expect(send).not.toHaveBeenCalled();
  });
  it("não declara envio concluído com transporte hard-off", async () => {
    expect(await processOneGa4Refund()).toBe("DISABLED");
    expect(updateEvent).toHaveBeenLastCalledWith({
      where: { id: "event", status: "PROCESSING" },
      data: { status: "PENDING", leaseUntil: null },
    });
  });
  it("não reenvia automaticamente respostas incertas", async () => {
    send.mockResolvedValueOnce({ kind: "UNCERTAIN" });
    expect(await processOneGa4Refund()).toBe("UNCERTAIN");
    expect(updateEvent).toHaveBeenLastCalledWith({
      where: { id: "event", status: "PROCESSING" },
      data: { status: "FAILED", leaseUntil: null, lastError: "delivery_uncertain" },
    });
  });
  it("marca 2xx apenas como aceito, não comprovado", async () => {
    send.mockResolvedValueOnce({ kind: "ACCEPTED_UNVERIFIED" });
    expect(await processOneGa4Refund()).toBe("ACCEPTED_UNVERIFIED");
  });
});
