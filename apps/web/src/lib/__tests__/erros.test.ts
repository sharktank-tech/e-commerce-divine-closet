import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { AppError, comErro, erroResposta, logErro } from "@/lib/erros";

describe("AppError", () => {
  it("padrão: 400 operacional com código genérico", () => {
    const err = new AppError("Erro genérico");
    expect(err.statusCode).toBe(400);
    expect(err.isOperational).toBe(true);
    expect(err.code).toBe("ERROR");
    expect(err).toBeInstanceOf(Error);
  });

  it("negócio 404: operacional (4xx = esperado)", () => {
    const err = new AppError("CEP não encontrado", 404, "INVALID_CEP");
    expect(err.statusCode).toBe(404);
    expect(err.isOperational).toBe(true);
    expect(err.code).toBe("INVALID_CEP");
  });

  it("sistema 500: não-operacional", () => {
    const err = new AppError("Falha interna", 500, "INTERNAL_ERROR");
    expect(err.isOperational).toBe(false);
  });

  it("JSON de resposta não expõe stack trace", async () => {
    const res = erroResposta(new AppError("Teste", 400, "TEST"));
    expect(res.status).toBe(400);
    const texto = await res.text();
    expect(texto).not.toContain("stack");
    expect(texto).not.toContain("at ");
    expect(JSON.parse(texto)).toEqual({
      success: false,
      error: "Teste",
      code: "TEST",
    });
  });
});

describe("logErro", () => {
  it("AppError: log estruturado sem stack", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logErro({ pedidoId: "abc" }, new AppError("Cupom inválido", 422, "INVALID_CUPOM"));
    const linha = String(spy.mock.calls[0][0]);
    expect(linha).toContain('"codigo":"INVALID_CUPOM"');
    expect(linha).toContain('"status":422');
    expect(linha).toContain('"pedidoId":"abc"');
    expect(linha).not.toContain("at ");
    spy.mockRestore();
  });

  it("erro desconhecido: log guarda detalhe (resposta é genérica, ver comErro)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logErro({}, new Error("segredo interno"));
    const linha = String(spy.mock.calls[0][0]);
    expect(linha).toContain('"codigo":"INTERNAL_ERROR"');
    expect(linha).toContain("segredo interno");
    spy.mockRestore();
  });
});

describe("comErro", () => {
  it("sucesso passa intacto", async () => {
    const manipulador = comErro(async () =>
      NextResponse.json({ ok: true }, { status: 201 })
    );
    const res = (await manipulador({} as never)) as NextResponse;
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("AppError vira JSON estruturado com o status", async () => {
    const manipulador = comErro(async () => {
      throw new AppError("Cupom inválido", 422, "INVALID_CUPOM");
    });
    const res = (await manipulador({} as never)) as NextResponse;
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      success: false,
      error: "Cupom inválido",
      code: "INVALID_CUPOM",
    });
  });

  it("erro desconhecido vira 500 genérico sem stack", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const manipulador = comErro(async () => {
      throw new Error("falha de banco simulada");
    });
    const res = (await manipulador({} as never)) as NextResponse;
    expect(res.status).toBe(500);
    const corpo = await res.json();
    expect(corpo).toEqual({
      success: false,
      error: "Ops! Algo deu errado. Tente novamente mais tarde.",
      code: "INTERNAL_ERROR",
    });
    spy.mockRestore();
  });
});
