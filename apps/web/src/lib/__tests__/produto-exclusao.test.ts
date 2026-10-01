import { describe, expect, it, vi } from "vitest";
import {
  aplicarExclusaoProduto,
  modoExclusaoProduto,
} from "@/lib/produto-exclusao";

function bancoFake(totalPedidos: number) {
  return {
    orderItem: { count: vi.fn(async () => totalPedidos) },
    product: {
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
  };
}

describe("modoExclusaoProduto", () => {
  it("produto com pedidos → desativar", () => {
    expect(modoExclusaoProduto(1)).toBe("desativar");
    expect(modoExclusaoProduto(25)).toBe("desativar");
  });

  it("produto sem pedidos → excluir", () => {
    expect(modoExclusaoProduto(0)).toBe("excluir");
  });
});

describe("aplicarExclusaoProduto", () => {
  it("produto com pedido associado: desativa, nunca apaga", async () => {
    const db = bancoFake(2);
    const modo = await aplicarExclusaoProduto(db, "prod-com-pedido");

    expect(modo).toBe("desativar");
    expect(db.orderItem.count).toHaveBeenCalledTimes(1);
    expect(db.product.update).toHaveBeenCalledTimes(1);
    expect(db.product.update).toHaveBeenCalledWith({
      where: { id: "prod-com-pedido" },
      data: { deletedAt: expect.any(Date), isActive: false },
    });
    expect(db.product.delete).not.toHaveBeenCalled();
  });

  it("produto sem pedido: hard delete liberado", async () => {
    const db = bancoFake(0);
    const modo = await aplicarExclusaoProduto(db, "prod-sem-pedido");

    expect(modo).toBe("excluir");
    expect(db.product.delete).toHaveBeenCalledTimes(1);
    expect(db.product.delete).toHaveBeenCalledWith({
      where: { id: "prod-sem-pedido" },
    });
    expect(db.product.update).not.toHaveBeenCalled();
  });
});
