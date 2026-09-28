import { describe, expect, it } from "vitest";
import { estadoEstoque, textoEstoque, ESTOQUE_BAIXO_LIMITE } from "../estoque";

describe("estadoEstoque", () => {
  it("mapeia as faixas", () => {
    expect(estadoEstoque(0)).toBe("esgotado");
    expect(estadoEstoque(-2)).toBe("esgotado");
    expect(estadoEstoque(1)).toBe("baixo");
    expect(estadoEstoque(ESTOQUE_BAIXO_LIMITE)).toBe("baixo");
    expect(estadoEstoque(ESTOQUE_BAIXO_LIMITE + 1)).toBe("disponivel");
    expect(estadoEstoque(63)).toBe("disponivel");
  });
});

describe("textoEstoque", () => {
  it("nunca expõe o número exato, exceto urgência", () => {
    expect(textoEstoque(0)).toBe("Esgotado");
    expect(textoEstoque(63)).toBe("Em estoque");
    expect(textoEstoque(63)).not.toContain("63");
    expect(textoEstoque(3)).toBe("Restam apenas 3 unidades");
    expect(textoEstoque(1)).toBe("Restam apenas 1 unidade");
  });
});
