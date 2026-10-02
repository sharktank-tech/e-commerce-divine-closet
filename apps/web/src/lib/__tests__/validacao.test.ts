import { describe, expect, it } from "vitest";
import {
  enderecoSchema,
  mascararCep,
  mascararTelefone,
  validarCep,
  validarEmail,
  validarNome,
  validarTelefone,
  verificarCepExiste,
} from "@/lib/validacao";

describe("validarNome", () => {
  it("vazio/não-string: obrigatório", () => {
    expect(validarNome("")).toBe("OBRIGATORIO");
    expect(validarNome("   ")).toBe("OBRIGATORIO");
    expect(validarNome(undefined)).toBe("OBRIGATORIO");
    expect(validarNome(123)).toBe("OBRIGATORIO");
  });

  it("curto/longo", () => {
    expect(validarNome("A")).toBe("CURTO");
    expect(validarNome("x".repeat(101))).toBe("LONGO");
    expect(validarNome("Ab")).toBe("OK");
    expect(validarNome("x".repeat(100))).toBe("OK");
  });

  it("acentos e espaços ok; dígitos/símbolos não", () => {
    expect(validarNome("José da Silva")).toBe("OK");
    expect(validarNome("João123")).toBe("FORMATO");
    expect(validarNome("Ana!")).toBe("FORMATO");
  });
});

describe("validarEmail", () => {
  it("vazio: obrigatório", () => {
    expect(validarEmail("")).toBe("OBRIGATORIO");
  });

  it("sem @: formato; sem ponto no domínio: domínio", () => {
    expect(validarEmail("sem-arroba")).toBe("FORMATO");
    expect(validarEmail("a@b")).toBe("DOMINIO");
  });

  it("domínio malformado: domínio", () => {
    expect(validarEmail("a@-b.com")).toBe("DOMINIO");
    expect(validarEmail("a@b.c")).toBe("DOMINIO");
  });

  it("válidos", () => {
    expect(validarEmail("cliente@exemplo.com.br")).toBe("OK");
    expect(validarEmail("a.b+tag@sub.dominio.co")).toBe("OK");
  });
});

describe("validarCep / verificarCepExiste", () => {
  it("formato: 8 dígitos com ou sem máscara", () => {
    expect(validarCep("01310-100")).toBe("OK");
    expect(validarCep("01310100")).toBe("OK");
    expect(validarCep("1234")).toBe("FORMATO");
    expect(validarCep("")).toBe("OBRIGATORIO");
  });

  it("lookup mockado: existe e não existe", async () => {
    expect(await verificarCepExiste("01310-100", async () => true)).toBe("OK");
    expect(await verificarCepExiste("01310-100", async () => false)).toBe(
      "INEXISTENTE"
    );
  });

  it("sem lookup: só formato, sem rede", async () => {
    expect(await verificarCepExiste("01310-100")).toBe("OK");
    expect(await verificarCepExiste("123")).toBe("FORMATO");
  });
});

describe("validarTelefone", () => {
  it("vazio opcional: ok; obrigatório: obrigatório", () => {
    expect(validarTelefone("")).toBe("OK");
    expect(validarTelefone(undefined)).toBe("OK");
    expect(validarTelefone("", { obrigatorio: true })).toBe("OBRIGATORIO");
  });

  it("tamanho errado: formato", () => {
    expect(validarTelefone("119999")).toBe("FORMATO");
    expect(validarTelefone("119999900001")).toBe("FORMATO");
  });

  it("DDD inexistente (00, 10, 20): DDD", () => {
    expect(validarTelefone("(00) 99999-0000")).toBe("DDD");
    expect(validarTelefone("(10) 9999-0000")).toBe("DDD");
    expect(validarTelefone("(20) 99999-0000")).toBe("DDD");
  });

  it("válidos com máscara", () => {
    expect(validarTelefone("(11) 99999-0000")).toBe("OK");
    expect(validarTelefone("(21) 3000-0000")).toBe("OK");
  });
});

describe("máscaras", () => {
  it("cep", () => {
    expect(mascararCep("01310100")).toBe("01310-100");
    expect(mascararCep("123")).toBe("123");
  });

  it("telefone", () => {
    expect(mascararTelefone("11999990000")).toBe("(11) 99999-0000");
    expect(mascararTelefone("2130000000")).toBe("(21) 3000-0000");
    expect(mascararTelefone("123")).toBe("123");
  });
});

describe("enderecoSchema", () => {
  const base = {
    street: "Rua Teste",
    number: "10",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    zipCode: "01310100",
  };

  it("endereço válido passa", () => {
    expect(enderecoSchema.safeParse(base).success).toBe(true);
  });

  it("rua curta falha (mensagem padrão do zod preservada)", () => {
    const r = enderecoSchema.safeParse({ ...base, street: "R" });
    expect(r.success).toBe(false);
  });
});
