// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, cleanup, waitFor, act } from "@testing-library/react";
import { TrackingScripts } from "@/components/loja/TrackingScripts";
const state = vi.hoisted(() => ({ path: "/produtos" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("dc-consent", "1");
  window.gtag = vi.fn();
  window.fbq = vi.fn();
  window.history.replaceState({}, "", "/produtos");
  state.path = "/produtos";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ granted: true }),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("navegação para rota privada pausa SDKs e não reenvia PageView", async () => {
  const ids = ["G-TEST"];
  const { rerender } = render(<TrackingScripts meta="123" gtag={ids} />);
  await waitFor(() => expect(window.dcTracking?.meta).toBe("123"));
  const calls = vi.mocked(window.gtag!).mock.calls.filter((c) => c[0] === "event" && c[1] === "page_view").length;
  state.path = "/newsletter/confirmar";
  rerender(<TrackingScripts meta="123" gtag={ids} />);
  expect(window.dcTracking).toBeUndefined();
  expect(window.fbq).toHaveBeenLastCalledWith("consent", "revoke");
  expect(vi.mocked(window.gtag!).mock.calls.filter((c) => c[0] === "event" && c[1] === "page_view")).toHaveLength(calls);
  state.path = "/produtos";
  rerender(<TrackingScripts meta="123" gtag={ids} />);
  await waitFor(() => expect(window.dcTracking?.ga4).toEqual(["G-TEST"]));
  expect(window.fbq).toHaveBeenCalledWith("consent", "grant");
});

it("sem aceite não injeta scripts nem consulta o servidor", () => {
  localStorage.setItem("dc-consent", "0");
  document.querySelectorAll("script[id^=dc-]").forEach((s) => s.remove());
  render(<TrackingScripts meta="123" gtag={["G-TEST"]} />);
  expect(document.getElementById("dc-meta")).toBeNull();
  expect(document.getElementById("dc-gtag")).toBeNull();
  expect(window.dcTracking).toBeUndefined();
  expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  expect(vi.mocked(window.gtag!).mock.calls.filter((c) => c[0] === "event")).toHaveLength(0);
});

it("não injeta SDKs enquanto resposta do servidor estiver pendente", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((r) => { resolve = r; });
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));
  document.querySelectorAll("script[id^=dc-]").forEach((s) => s.remove());
  render(<TrackingScripts meta="123" gtag={["G-TEST"]} />);
  expect(window.dcTracking).toBeUndefined();
  expect(document.getElementById("dc-gtag")).toBeNull();
  await act(async () => { resolve({ ok: true, json: async () => ({ granted: true }) }); await pending; });
  await waitFor(() => expect(window.dcTracking?.ga4).toEqual(["G-TEST"]));
});

it("token perdido ou revogado no servidor interrompe tracking e sincroniza recusa", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ granted: false }),
  }));
  render(<TrackingScripts meta="123" gtag={["G-TEST"]} />);
  await waitFor(() => expect(localStorage.getItem("dc-consent")).toBe("0"));
  expect(window.dcTracking).toBeUndefined();
  expect(window.gtag).toHaveBeenCalledWith("consent", "update", expect.objectContaining({ analytics_storage: "denied" }));
});

it("falha do GET desliga tracking sem apagar preferência local", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
  render(<TrackingScripts meta="123" gtag={["G-TEST"]} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem("dc-consent")).toBe("1");
  expect(window.dcTracking).toBeUndefined();
  expect(window.gtag).toHaveBeenCalledWith("consent", "update", expect.objectContaining({ analytics_storage: "denied" }));
});

it("revogação em outra aba interrompe SDKs imediatamente", async () => {
  render(<TrackingScripts meta="123" gtag={["G-TEST"]} />);
  await waitFor(() => expect(window.dcTracking?.meta).toBe("123"));
  localStorage.setItem("dc-consent", "0");
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: "dc-consent", newValue: "0" })));
  expect(window.dcTracking).toBeUndefined();
  expect(window.fbq).toHaveBeenLastCalledWith("consent", "revoke");
});

it("aba em foco revalida consentimento sem reenviar PageView", async () => {
  render(<TrackingScripts meta="" gtag={["G-TEST"]} />);
  await waitFor(() => expect(window.dcTracking?.ga4).toEqual(["G-TEST"]));
  const pageViewsBefore = vi.mocked(window.gtag!).mock.calls.filter(c => c[0] === "event" && c[1] === "page_view").length;
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(window.dcTracking?.ga4).toEqual(["G-TEST"]));
  const pageViewsAfter = vi.mocked(window.gtag!).mock.calls.filter(c => c[0] === "event" && c[1] === "page_view").length;
  expect(pageViewsAfter).toBe(pageViewsBefore);
});


it("resposta GRANTED antiga não reativa SDKs depois da recusa de outra aba", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((r) => { resolve = r; });
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));
  render(<TrackingScripts meta="" gtag={["G-TEST"]} />);
  expect(window.dcTracking).toBeUndefined();
  localStorage.setItem("dc-consent", "0");
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: "dc-consent", newValue: "0" })));
  await act(async () => {
    resolve({ ok: true, json: async () => ({ granted: true }) });
    await pending;
  });
  expect(window.dcTracking).toBeUndefined();
  expect(localStorage.getItem("dc-consent")).toBe("0");
  expect(vi.mocked(window.gtag!).mock.calls.filter((c) => c[0] === "event" && c[1] === "page_view")).toHaveLength(0);
});
