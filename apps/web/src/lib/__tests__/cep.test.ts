import { describe, expect, it, vi } from "vitest";
import { buscarEnderecoPorCep } from "@/lib/cep";

function fetchDe(resposta: unknown, ok = true) {
  return (async () => ({ ok, json: async () => resposta })) as unknown as typeof fetch;
}

describe("buscarEnderecoPorCep", () => {
  it("mapeia logradouro/bairro/cidade/UF", async () => {
    const r = await buscarEnderecoPorCep(
      "01310-100",
      fetchDe({ logradouro: "Av. Paulista", bairro: "Bela Vista", localidade: "São Paulo", uf: "SP" })
    );
    expect(r).toEqual({ street: "Av. Paulista", neighborhood: "Bela Vista", city: "São Paulo", state: "SP" });
  });

  it("CEP inexistente (erro:true) → null", async () => {
    await expect(buscarEnderecoPorCep("00000000", fetchDe({ erro: true }))).resolves.toBeNull();
  });

  it("formato inválido nem chama a rede", async () => {
    const f = vi.fn(fetchDe({}));
    await expect(buscarEnderecoPorCep("123", f)).resolves.toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("falha HTTP → throw (preencher manualmente)", async () => {
    await expect(buscarEnderecoPorCep("01310100", fetchDe({}, false))).rejects.toThrow();
  });

  it("campos ausentes viram string vazia", async () => {
    const r = await buscarEnderecoPorCep("01310100", fetchDe({ localidade: "São Paulo", uf: "SP" }));
    expect(r).toEqual({ street: "", neighborhood: "", city: "São Paulo", state: "SP" });
  });
});
