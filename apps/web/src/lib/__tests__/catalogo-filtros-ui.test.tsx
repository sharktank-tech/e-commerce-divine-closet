// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CatalogoFiltros } from "@/components/loja/CatalogoFiltros";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
let currentSearch = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => currentSearch,
}));

const defaults = {
  basePath: "/produtos",
  q: "",
  categoria: "",
  sort: "recent",
  precoMin: 0,
  precoMax: 0,
  soEstoque: false,
  filtrosAtivos: 0,
};

beforeEach(() => {
  currentSearch = new URLSearchParams();
  push.mockClear();
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("CatalogoFiltros — drawer e navegação", () => {
  it("aplica filtros, preserva oferta=1 e remove paginação da URL", () => {
    currentSearch = new URLSearchParams("oferta=1&page=4");
    render(<CatalogoFiltros {...defaults} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    fireEvent.change(screen.getByLabelText("Preço mínimo (R$)"), { target: { value: "35" } });
    fireEvent.change(screen.getByLabelText("Preço máximo (R$)"), { target: { value: "50" } });
    fireEvent.click(screen.getByLabelText("Apenas em estoque"));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    expect(push).toHaveBeenCalledWith(
      "/produtos?oferta=1&preco_min=35&preco_max=50&estoque=1"
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("permite remover um único chip sem apagar os demais filtros", () => {
    currentSearch = new URLSearchParams("preco_min=35&preco_max=50&estoque=1");
    render(<CatalogoFiltros {...defaults} precoMin={35} precoMax={50} soEstoque filtrosAtivos={3} />);
    expect(screen.getByLabelText("Filtros ativos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remover Máx: R$50" }));
    expect(push).toHaveBeenCalledWith("/produtos?preco_min=35&estoque=1");
  });

  it("limpa filtros e query string mantendo rota da categoria", () => {
    currentSearch = new URLSearchParams("preco_min=35&estoque=1&page=5");
    render(<CatalogoFiltros {...defaults} basePath="/categoria/shorts" categoria="shorts" lockedCategoria="shorts" />);
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(push).toHaveBeenCalledWith("/categoria/shorts");
  });

  it("não toma foco no mount; Escape devolve foco e restaura overflow", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    document.body.style.overflow = "clip";
    render(<CatalogoFiltros {...defaults} />);
    expect(document.activeElement).toBe(outside);
    const trigger = screen.getByRole("button", { name: "Filtros" });
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Fechar filtros" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("clip");
    outside.remove();
  });

  it("Tab e Shift+Tab ciclam entre último e primeiro foco do drawer", () => {
    render(<CatalogoFiltros {...defaults} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    const first = screen.getByRole("button", { name: "Fechar filtros" });
    const last = screen.getByRole("button", { name: "Limpar" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("associa labels a inputs e expõe ordenação acessível", () => {
    render(<CatalogoFiltros {...defaults} />);
    expect(screen.getByLabelText("Ordenar produtos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.getByLabelText("Preço mínimo (R$)")).toHaveAttribute("name", "preco_min");
    expect(screen.getByLabelText("Preço máximo (R$)")).toHaveAttribute("name", "preco_max");
  });
});
