// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { Header } from "@/components/layout/Header";

type LinkProps = {
  href: string;
  children?: ReactNode;
  className?: string;
  "aria-label"?: string;
  onClick?: () => void;
};

vi.mock("next/link", () => ({
  default: ({ href, children, className, "aria-label": ariaLabel, onClick }: LinkProps) =>
    createElement(
      "a",
      { href, className, "aria-label": ariaLabel, onClick },
      children
    ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function stubSession(role: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url.startsWith("/api/auth/me")) {
        return Promise.resolve(
          role
            ? {
                ok: true,
                json: async () => ({
                  user: { name: "Teste", email: "teste@example.com", role },
                }),
              }
            : { ok: false, json: async () => ({}) }
        );
      }
      if (url.startsWith("/api/categorias")) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      }
      if (url.startsWith("/api/produtos")) {
        return Promise.resolve({ ok: true, json: async () => ({ total: 0 }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    })
  );
}

async function renderHeader(role: string | null) {
  stubSession(role);
  render(createElement(Header));
  await act(async () => {});
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Header — links de conta por role", () => {
  it("ADMIN vê 'Painel Admin' e 'Minha conta' lado a lado", async () => {
    await renderHeader("ADMIN");
    expect(await screen.findByLabelText("Painel admin")).toBeInTheDocument();
    expect(screen.getByLabelText("Minha conta")).toBeInTheDocument();
    expect(screen.getByLabelText("Sair")).toBeInTheDocument();
  });

  it("OPERATOR vê 'Painel Admin' e 'Minha conta'", async () => {
    await renderHeader("OPERATOR");
    expect(screen.getByLabelText("Painel admin")).toBeInTheDocument();
    expect(screen.getByLabelText("Minha conta")).toBeInTheDocument();
  });

  it("CLIENT vê só 'Minha conta', sem 'Painel Admin'", async () => {
    await renderHeader("CLIENT");
    expect(screen.getByLabelText("Minha conta")).toBeInTheDocument();
    expect(screen.queryByLabelText("Painel admin")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Sair")).toBeInTheDocument();
  });

  it("deslogado não vê nenhum dos dois links", async () => {
    await renderHeader(null);
    expect(screen.queryByLabelText("Painel admin")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Minha conta")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sair")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Entrar").length).toBeGreaterThan(0);
  });

  it("logout encerra a sessão via POST /api/auth/logout", async () => {
    await renderHeader("CLIENT");
    expect(screen.getByLabelText("Minha conta")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Sair"));
    await act(async () => {});
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([u]) => String(u).startsWith("/api/auth/logout"))).toBe(
      true
    );
    expect(screen.queryByLabelText("Minha conta")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sair")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Entrar").length).toBeGreaterThan(0);
  });
});
