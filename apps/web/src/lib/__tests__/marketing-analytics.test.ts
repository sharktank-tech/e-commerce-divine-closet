// @vitest-environment jsdom
import { beforeEach, it, expect, vi } from "vitest";
import {
  analytics,
  setConsent,
  captureUtm,
  checkoutUtm,
  privateAnalyticsPath,
} from "@/lib/analytics";
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(
    {},
    "",
    "/produtos?utm_source=instagram&utm_medium=social&utm_campaign=lancamento",
  );
  window.gtag = vi.fn();
  window.fbq = vi.fn();
  window.dcTracking = { ga4: ["G-TEST"], ads: [], meta: "123" };
});
it("antes do consentimento e depois da revogação não emite nem captura UTM", () => {
  analytics.addToCart([{ id: "p", name: "Peça", price: 10, quantity: 1 }]);
  captureUtm();
  expect(window.gtag).not.toHaveBeenCalled();
  expect(checkoutUtm()).toBeUndefined();
  setConsent(true);
  captureUtm();
  expect(checkoutUtm().source).toBe("instagram");
  setConsent(false);
  analytics.beginCheckout(10, []);
  expect(
    vi.mocked(window.gtag!).mock.calls.filter((c) => c[0] === "event"),
  ).toHaveLength(0);
  expect(sessionStorage.getItem("dc-utm")).toBeNull();
});
it("eventos são enviados a GA4 e Meta, sem querystring; compra deduplicada", () => {
  setConsent(true);
  analytics.addToCart([{ id: "p", name: "Peça", price: 10, quantity: 1 }]);
  expect(window.gtag).toHaveBeenCalledWith(
    "event",
    "add_to_cart",
    expect.objectContaining({
      send_to: ["G-TEST"],
      page_location: "http://localhost:3000/produtos",
    }),
  );
  analytics.purchase("order-id", 10, []);
  analytics.purchase("order-id", 10, []);
  expect(
    vi.mocked(window.gtag!).mock.calls.filter((c) => c[1] === "purchase"),
  ).toHaveLength(1);
  expect(JSON.stringify(vi.mocked(window.gtag!).mock.calls)).not.toContain(
    "utm_campaign",
  );
});
it("não consome dedupe antes de consentimento ou transporte disponível", () => {
  analytics.purchase("o", 10, []);
  expect(localStorage.getItem("dc-purchase-o")).toBeNull();
  setConsent(true);
  window.dcTracking = undefined;
  analytics.purchase("o", 10, []);
  expect(localStorage.getItem("dc-purchase-o")).toBeNull();
});
it("rotas com token nunca emitem eventos", () => {
  setConsent(true);
  window.history.replaceState({}, "", "/newsletter/confirmar?token=private");
  analytics.purchase("o", 10, []);
  expect(window.gtag).not.toHaveBeenCalled();
  expect(privateAnalyticsPath("/acompanhar/private")).toBe(true);
});

it("revogar informa os SDKs existentes e apaga a prova temporária de conversão", () => {
  setConsent(true);
  sessionStorage.setItem("dc-conversion-proof:test", "secret");
  setConsent(false);
  expect(window.gtag).toHaveBeenCalledWith(
    "consent",
    "update",
    expect.objectContaining({
      analytics_storage: "denied",
      ad_storage: "denied",
    }),
  );
  expect(window.fbq).toHaveBeenCalledWith("consent", "revoke");
  expect(window.dcTracking).toBeUndefined();
  expect(sessionStorage.getItem("dc-conversion-proof:test")).toBeNull();
});
