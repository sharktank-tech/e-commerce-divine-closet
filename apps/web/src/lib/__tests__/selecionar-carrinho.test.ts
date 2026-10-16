import { describe, expect, it } from "vitest";
import { escolherCarrinho } from "@/lib/pedidos/selecionar-carrinho";

describe("escolherCarrinho", () => {
  it("vazio → null", () => {
    expect(escolherCarrinho([])).toBeNull();
  });

  it("prefere o carrinho com itens (convidado vazio + usuário cheio)", () => {
    const vazio = { id: "guest", items: [] };
    const cheio = { id: "user", items: [{ id: "i1" }] };
    // Qualquer ordem de chegada do banco: o com itens vence.
    expect(escolherCarrinho([vazio, cheio])).toBe(cheio);
    expect(escolherCarrinho([cheio, vazio])).toBe(cheio);
  });

  it("todos vazios → o primeiro (mantém erro 'Carrinho vazio' legítimo)", () => {
    const a = { id: "a", items: [] };
    expect(escolherCarrinho([a])).toBe(a);
  });
});
