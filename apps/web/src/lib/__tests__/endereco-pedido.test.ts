import { describe, expect, it, vi } from "vitest";
import {
  EnderecoInvalidoError,
  resolverEnderecoPedido,
} from "@/lib/pedidos/endereco-pedido";

const dados = {
  street: "Rua das Flores",
  number: "s/n",
  complement: null,
  neighborhood: "Centro",
  city: "São Paulo",
  state: "sp",
  zipCode: "01310100",
};

function txCom(salvo: any) {
  return {
    address: {
      findUnique: vi.fn(async () => salvo),
      create: vi.fn(async (args: any) => ({ id: "criado", ...args.data })),
    },
  };
}

describe("resolverEnderecoPedido (posse do addressId)", () => {
  it("id da própria conta → reutiliza o registro salvo (sem duplicar)", async () => {
    const salvo = { id: "addr-1", userId: "user-1", street: "X" };
    const tx = txCom(salvo);
    const r = await resolverEnderecoPedido(tx, {
      session: { sub: "user-1" },
      addressId: "addr-1",
      dados,
    });
    expect(r).toBe(salvo);
    expect(tx.address.create).not.toHaveBeenCalled();
  });

  it("id de OUTRA conta → EnderecoInvalidoError (400, sem vazar existência)", async () => {
    const tx = txCom({ id: "addr-1", userId: "outra-conta" });
    await expect(
      resolverEnderecoPedido(tx, {
        session: { sub: "user-1" },
        addressId: "addr-1",
        dados,
      })
    ).rejects.toThrow(EnderecoInvalidoError);
    expect(tx.address.create).not.toHaveBeenCalled();
  });

  it("id inexistente → mesmo erro genérico de posse", async () => {
    const tx = txCom(null);
    await expect(
      resolverEnderecoPedido(tx, {
        session: { sub: "user-1" },
        addressId: "nao-existe",
        dados,
      })
    ).rejects.toThrow("Endereço inválido");
  });

  it("addressId sem sessão (convidado forjando) → recusa", async () => {
    const tx = txCom({ id: "addr-1", userId: "user-1" });
    await expect(
      resolverEnderecoPedido(tx, { session: null, addressId: "addr-1", dados })
    ).rejects.toThrow(EnderecoInvalidoError);
  });

  it("sem addressId (convidado ou manual) → cria inline anônimo", async () => {
    const tx = txCom(null);
    const r = await resolverEnderecoPedido(tx, { session: null, addressId: null, dados });
    expect(tx.address.create).toHaveBeenCalledTimes(1);
    expect(r.userId).toBeNull();
    expect(r.state).toBe("SP"); // normalizado
  });

  it("logado sem addressId → cria inline ligado à conta", async () => {
    const tx = txCom(null);
    const r = await resolverEnderecoPedido(tx, {
      session: { sub: "user-1" },
      addressId: null,
      dados,
    });
    expect(r.userId).toBe("user-1");
  });
});
