import { describe, expect, it } from "vitest";
import { revalidarItem } from "@/lib/carrinho-revalidacao";

const base = {
  unitPriceCentavos: 19990,
  precoAtualCentavos: 19990,
  ativo: true,
  estoqueSuficiente: true,
};

describe("revalidarItem", () => {
  it("preço igual e disponível: sem aviso", () => {
    expect(revalidarItem(base)).toBeNull();
  });

  it("preço subiu: aviso com valores antigo e novo", () => {
    expect(
      revalidarItem({ ...base, precoAtualCentavos: 24990 })
    ).toEqual({ tipo: "preco", deCentavos: 19990, paraCentavos: 24990 });
  });

  it("preço caiu: aviso também (para mais ou para menos)", () => {
    expect(
      revalidarItem({ ...base, precoAtualCentavos: 14990 })
    ).toEqual({ tipo: "preco", deCentavos: 19990, paraCentavos: 14990 });
  });

  it("produto desativado: indisponível (mesmo com preço mudado)", () => {
    expect(
      revalidarItem({ ...base, ativo: false, precoAtualCentavos: 24990 })
    ).toEqual({ tipo: "indisponivel" });
  });

  it("produto sumiu: indisponível", () => {
    expect(
      revalidarItem({ ...base, precoAtualCentavos: null })
    ).toEqual({ tipo: "indisponivel" });
  });

  it("estoque insuficiente: aviso de estoque", () => {
    expect(revalidarItem({ ...base, estoqueSuficiente: false })).toEqual({
      tipo: "estoque",
    });
  });

  it("item legado sem snapshot: sem aviso de preço", () => {
    expect(
      revalidarItem({ ...base, unitPriceCentavos: null })
    ).toBeNull();
  });
});
