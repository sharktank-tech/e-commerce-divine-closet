// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConsentBanner } from "@/components/loja/ConsentBanner";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GA4 consent banner — sincronização entre abas", () => {
  it("mostra escolha inicial e fecha o banner se outra aba aceitar", async () => {
    render(<ConsentBanner />);
    expect(screen.getByRole("button", { name: "Aceitar" })).toBeInTheDocument();
    localStorage.setItem("dc-consent", "1");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "dc-consent", newValue: "1" })));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Aceitar" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Preferências de cookies" })).toBeInTheDocument();
  });

  it("reabre a escolha quando o storage é apagado em outra aba", async () => {
    localStorage.setItem("dc-consent", "1");
    render(<ConsentBanner />);
    expect(screen.getByRole("button", { name: "Preferências de cookies" })).toBeInTheDocument();
    localStorage.removeItem("dc-consent");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "dc-consent", newValue: null })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Recusar" })).toBeInTheDocument());
  });

  it("a recusa é aplicada localmente e enviada ao servidor, mesmo sem cookie", async () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Recusar" }));
    expect(localStorage.getItem("dc-consent")).toBe("0");
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/analytics/consent", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ granted: false }),
    })));
  });

  it("falha na concessão nunca marca aceite local", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível salvar"));
    expect(localStorage.getItem("dc-consent")).toBe("0");
  });
});
