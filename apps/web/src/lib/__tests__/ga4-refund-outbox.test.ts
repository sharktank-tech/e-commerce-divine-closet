import { beforeEach, describe, expect, it, vi } from "vitest";

const { orderFind, eventCreate, browserConsentFind } = vi.hoisted(() => ({
  orderFind: vi.fn(),
  eventCreate: vi.fn(),
  browserConsentFind: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findUnique: orderFind },
    analyticsEvent: { create: eventCreate },
    analyticsBrowserConsent: { findUnique: browserConsentFind },
  },
}));
import { enqueueGa4RefundIfAuthorized } from "../ga4-refund-outbox";

const order = {
  id: "6fda65c2-7a90-4f18-88e8-1878f5a4c5de",
  paymentStatus: "REFUNDED",
  refund: { id: "39a1be2b-983c-4d03-98ba-c25ac36c99fb", status: "APPROVED" },
  analyticsIdentity: {
    consentState: "GRANTED",
    consentProofAt: new Date("2026-11-04T12:00:00Z"),
    revokedAt: null,
    clientId: "123456.789012",
    consentTokenId: "49a1be2b-983c-4d03-98ba-c25ac36c99fb",
  },
  subtotal: "100.00", discount: "0.00", shipping: "10.00", total: "110.00",
  items: [{ productId: "p1", productName: "Blusa", quantity: 1, unitPrice: "100.00" }],
};
describe("GA4 refund outbox: fail-closed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    orderFind.mockResolvedValue(order);
    eventCreate.mockResolvedValue({ id: "persistido" });
    browserConsentFind.mockResolvedValue({ state: "GRANTED", revokedAt: null, expiresAt: new Date("2030-01-01") });
  });
  it("não enfileira estorno pendente", async () => {
    orderFind.mockResolvedValue({ ...order, refund: { ...order.refund, status: "REQUESTED" } });
    expect(await enqueueGa4RefundIfAuthorized(order.id)).toBe("SKIPPED");
    expect(eventCreate).not.toHaveBeenCalled();
  });
  it("não enfileira sem prova persistida ou com revogação", async () => {
    orderFind.mockResolvedValue({ ...order, analyticsIdentity: { ...order.analyticsIdentity, consentProofAt: null } });
    expect(await enqueueGa4RefundIfAuthorized(order.id)).toBe("SKIPPED");
    orderFind.mockResolvedValue({ ...order, analyticsIdentity: { ...order.analyticsIdentity, revokedAt: new Date() } });
    expect(await enqueueGa4RefundIfAuthorized(order.id)).toBe("SKIPPED");
    expect(eventCreate).not.toHaveBeenCalled();
  });
  it("não enfileira quando o consentimento do navegador foi revogado", async () => {
    browserConsentFind.mockResolvedValue({ state: "REVOKED", revokedAt: new Date(), expiresAt: new Date("2030-01-01") });
    expect(await enqueueGa4RefundIfAuthorized(order.id)).toBe("SKIPPED");
    expect(eventCreate).not.toHaveBeenCalled();
  });
  it("não enfileira se o pedido não estiver estornado", async () => {
    orderFind.mockResolvedValue({ ...order, paymentStatus: "PAID" });
    expect(await enqueueGa4RefundIfAuthorized(order.id)).toBe("SKIPPED");
  });
  it("enfileira uma intenção sem client ID no payload", async () => {
    expect(await enqueueGa4RefundIfAuthorized(order.id)).toBe("CREATED");
    const data = eventCreate.mock.calls[0][0].data;
    expect(data.dedupeKey).toBe("ga4:refund:39a1be2b-983c-4d03-98ba-c25ac36c99fb");
    expect(data.status).toBe("PENDING");
    expect(data.payload.value).toBe(100);
    expect(JSON.stringify(data.payload)).not.toContain("123456.789012");
  });
  it("colisão do índice UNIQUE não cria segunda intenção", async () => {
    eventCreate.mockRejectedValue({ code: "P2002" });
    expect(await enqueueGa4RefundIfAuthorized(order.id)).toBe("ALREADY_EXISTS");
  });
  it("não converte erros inesperados em sucesso", async () => {
    eventCreate.mockRejectedValue(new Error("database unavailable"));
    await expect(enqueueGa4RefundIfAuthorized(order.id)).rejects.toThrow("database unavailable");
  });
});
