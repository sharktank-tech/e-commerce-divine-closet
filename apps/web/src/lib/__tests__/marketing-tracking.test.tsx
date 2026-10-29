// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
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
});
afterEach(() => cleanup());
it("navegação para rota privada pausa os SDKs sem PageView adicional", () => {
  const ids = ["G-TEST"];
  const { rerender } = render(<TrackingScripts meta="123" gtag={ids} />);
  expect(window.dcTracking?.meta).toBe("123");
  const calls = vi
    .mocked(window.gtag!)
    .mock.calls.filter((c) => c[0] === "event" && c[1] === "page_view").length;
  state.path = "/newsletter/confirmar";
  rerender(<TrackingScripts meta="123" gtag={ids} />);
  expect(window.dcTracking).toBeUndefined();
  expect(window.fbq).toHaveBeenLastCalledWith("consent", "revoke");
  expect(
    vi
      .mocked(window.gtag!)
      .mock.calls.filter((c) => c[0] === "event" && c[1] === "page_view"),
  ).toHaveLength(calls);
  expect(window.gtag).toHaveBeenLastCalledWith(
    "consent",
    "update",
    expect.objectContaining({ analytics_storage: "denied" }),
  );
  state.path = "/produtos";
  rerender(<TrackingScripts meta="123" gtag={ids} />);
  expect(window.dcTracking?.ga4).toEqual(["G-TEST"]);
  expect(window.fbq).toHaveBeenCalledWith("consent", "grant");
});
it("sem aceite não injeta scripts nem configura rastreamento", () => {
  localStorage.setItem("dc-consent", "0");
  document.querySelectorAll("script[id^=dc-]").forEach((s) => s.remove());
  render(<TrackingScripts meta="123" gtag={["G-TEST"]} />);
  expect(document.getElementById("dc-meta")).toBeNull();
  expect(document.getElementById("dc-gtag")).toBeNull();
  expect(window.dcTracking).toBeUndefined();
  expect(
    vi.mocked(window.gtag!).mock.calls.filter((c) => c[0] === "event"),
  ).toHaveLength(0);
});
