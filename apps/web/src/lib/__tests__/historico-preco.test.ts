import { describe, expect, it, vi } from "vitest";
import { registrarMudancaPreco } from "@/lib/historico-preco";

function bancoFake() {
  return {
    historicoPreco: { create: vi.fn(async () => ({})) },
  };
}

describe("registrarMudancaPreco", () => {
  it("preço mudou: grava linha com origem e usuário", async () => {
    const db = bancoFake();
    const ok = await registrarMudancaPreco(db, {
      produtoId: "prod-1",
      usuarioId: "admin-1",
      precoAnteriorCentavos: 19990,
      precoNovoCentavos: 24990,
      origem: "edicao_manual",
    });

    expect(ok).toBe(true);
    expect(db.historicoPreco.create).toHaveBeenCalledTimes(1);
    expect(db.historicoPreco.create).toHaveBeenCalledWith({
      data: {
        produto_id: "prod-1",
        usuario_id: "admin-1",
        preco_anterior_centavos: 19990,
        preco_novo_centavos: 24990,
        origem: "edicao_manual",
      },
    });
  });

  it("preço igual: não gera linha", async () => {
    const db = bancoFake();
    const ok = await registrarMudancaPreco(db, {
      produtoId: "prod-1",
      usuarioId: "admin-1",
      precoAnteriorCentavos: 19990,
      precoNovoCentavos: 19990,
      origem: "recalculo_massa",
    });

    expect(ok).toBe(false);
    expect(db.historicoPreco.create).not.toHaveBeenCalled();
  });

  it("criação via import: anterior 0 gera linha", async () => {
    const db = bancoFake();
    const ok = await registrarMudancaPreco(db, {
      produtoId: "prod-2",
      usuarioId: "admin-1",
      precoAnteriorCentavos: 0,
      precoNovoCentavos: 14990,
      origem: "import_csv",
    });

    expect(ok).toBe(true);
    expect(db.historicoPreco.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ origem: "import_csv" }),
    });
  });
});
