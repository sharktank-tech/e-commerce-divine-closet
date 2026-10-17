import { describe, expect, it } from "vitest";
import {
  chaveFrete,
  deveCalcularFrete,
  enderecoParaForm,
  enderecoValido,
  escolherEnderecoInicial,
  formIgualEndereco,
  freteCobreChave,
  type EnderecoSalvo,
  type FormEndereco,
} from "@/lib/checkout/enderecos-checkout";

const formBase: FormEndereco = {
  street: "Rua das Flores",
  number: "100",
  complement: "",
  neighborhood: "Centro",
  city: "São Paulo",
  state: "SP",
  zipCode: "01310-100",
};

function salvo(parcial: Partial<EnderecoSalvo> = {}): EnderecoSalvo {
  return {
    id: "id-1",
    label: "Casa",
    street: "Rua das Flores",
    number: "100",
    complement: null,
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    zipCode: "01310-100",
    isDefault: false,
    ...parcial,
  };
}

describe("escolherEnderecoInicial", () => {
  const padrao = salvo({ id: "p", isDefault: true });
  const outro = salvo({ id: "o", street: "Outra Rua" });

  it("escolha guardada da compra atual prevalece sobre o padrão", () => {
    expect(escolherEnderecoInicial([padrao, outro], "o")?.id).toBe("o");
  });

  it("guardado inexistente cai no padrão", () => {
    expect(escolherEnderecoInicial([padrao, outro], "some")?.id).toBe("p");
  });

  it("sem guardado usa o padrão", () => {
    expect(escolherEnderecoInicial([outro, padrao], null)?.id).toBe("p");
  });

  it("um único endereço sem padrão é usado", () => {
    expect(escolherEnderecoInicial([outro], null)?.id).toBe("o");
  });

  it("vários sem padrão → null (exigir seleção)", () => {
    expect(escolherEnderecoInicial([outro, salvo({ id: "x" })], null)).toBeNull();
  });

  it("lista vazia → null", () => {
    expect(escolherEnderecoInicial([], null)).toBeNull();
  });
});

describe("enderecoValido (número NÃO é exigido)", () => {
  it("endereço completo sem número é válido", () => {
    expect(enderecoValido({ ...formBase, number: "" })).toBe(true);
    expect(enderecoValido({ ...formBase, number: "s/n" })).toBe(true);
  });

  it("falta de rua/bairro/cidade/UF/CEP invalida", () => {
    expect(enderecoValido({ ...formBase, street: "R" })).toBe(false);
    expect(enderecoValido({ ...formBase, neighborhood: "" })).toBe(false);
    expect(enderecoValido({ ...formBase, city: "" })).toBe(false);
    expect(enderecoValido({ ...formBase, state: "S" })).toBe(false);
    expect(enderecoValido({ ...formBase, zipCode: "0131" })).toBe(false);
  });
});

describe("chaveFrete / freteCobreChave", () => {
  it("mesma combinação → mesma chave; CEP com máscara = sem máscara", () => {
    expect(chaveFrete("01310-100", 50, null)).toBe(chaveFrete("01310100", 50, null));
  });

  it("cep/subtotal/cupom diferentes mudam a chave", () => {
    expect(chaveFrete("01310100", 50, null)).not.toBe(chaveFrete("01310101", 50, null));
    expect(chaveFrete("01310100", 50, null)).not.toBe(chaveFrete("01310100", 51, null));
    expect(chaveFrete("01310100", 50, null)).not.toBe(chaveFrete("01310100", 50, "OFF"));
  });

  it("frete só cobre a chave atual (resposta antiga não vale)", () => {
    const frete = { chave: chaveFrete("01310100", 50, null) };
    expect(freteCobreChave(frete, chaveFrete("01310100", 50, null))).toBe(true);
    expect(freteCobreChave(frete, chaveFrete("99999999", 50, null))).toBe(false);
    expect(freteCobreChave(null, chaveFrete("01310100", 50, null))).toBe(false);
  });
});

describe("deveCalcularFrete", () => {
  const base = {
    enderecoOk: true,
    carrinhoCarregado: true,
    chaveAtual: "k1",
    frete: null as { chave: string } | null,
    emAndamento: false,
    chaveEmAndamento: null as string | null,
    falhaAtual: false,
  };

  it("endereço completo sem resultado → calcula", () => {
    expect(deveCalcularFrete(base)).toBe(true);
  });

  it("endereço incompleto ou carrinho carregando → não calcula", () => {
    expect(deveCalcularFrete({ ...base, enderecoOk: false })).toBe(false);
    expect(deveCalcularFrete({ ...base, carrinhoCarregado: false })).toBe(false);
  });

  it("resultado atual já cobre a chave → não repete (dedupe)", () => {
    expect(deveCalcularFrete({ ...base, frete: { chave: "k1" } })).toBe(false);
  });

  it("resposta velha de outra combinação não impede novo cálculo", () => {
    expect(deveCalcularFrete({ ...base, frete: { chave: "velha" } })).toBe(true);
  });

  it("requisição idêntica em andamento → não duplica", () => {
    expect(
      deveCalcularFrete({ ...base, emAndamento: true, chaveEmAndamento: "k1" })
    ).toBe(false);
    expect(
      deveCalcularFrete({ ...base, emAndamento: true, chaveEmAndamento: "outra" })
    ).toBe(true);
  });

  it("falha prévia p/ a chave atual → sem retry automático (só manual)", () => {
    expect(deveCalcularFrete({ ...base, falhaAtual: true })).toBe(false);
    // falha em OUTRA chave (quando a chave muda, o chamador zera falhaAtual)
    // → o novo cálculo segue normalmente
    expect(deveCalcularFrete({ ...base, falhaAtual: false, chaveAtual: "k2" })).toBe(true);
  });
});

describe("formIgualEndereco / enderecoParaForm", () => {
  it("idêntico (número vazio ≡ s/n, CEP com ou sem máscara) → true", () => {
    expect(formIgualEndereco({ ...formBase, number: "" }, salvo({ number: "s/n" }))).toBe(true);
    expect(
      formIgualEndereco({ ...formBase, zipCode: "01310100" }, salvo({ zipCode: "01310-100" }))
    ).toBe(true);
  });

  it("qualquer campo diferente → false", () => {
    expect(formIgualEndereco({ ...formBase, street: "Rua Outra" }, salvo())).toBe(false);
    expect(formIgualEndereco({ ...formBase, complement: "ap 1" }, salvo())).toBe(false);
    expect(formIgualEndereco({ ...formBase, state: "RJ" }, salvo())).toBe(false);
  });

  it("enderecoParaForm mapeia o salvo para o form (complemento null → vazio)", () => {
    expect(enderecoParaForm(salvo({ complement: null }))).toEqual({
      street: "Rua das Flores",
      number: "100",
      complement: "",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zipCode: "01310-100",
    });
  });
});
