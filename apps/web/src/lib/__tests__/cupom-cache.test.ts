import { describe, expect, it, vi, afterEach } from "vitest";
import {
  criarCache,
  estatisticasCupomCache,
  invalidarCupom,
  obterCupom,
  ttlCuponsMs,
  TTL_PADRAO_MS,
} from "@/lib/cupom-cache";

function cupomLinha(override = {}) {
  return {
    id: "cupom-1",
    code: "TESTE10",
    type: "PERCENT",
    value: 10,
    minSubtotal: null,
    maxUses: null,
    usedCount: 0,
    active: true,
    startsAt: new Date("2026-01-01T00:00:00Z"),
    endsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...override,
  } as never;
}

describe("criarCache", () => {
  it("miss, hit e estatísticas", () => {
    const agora = { t: 0 };
    const c = criarCache<string>({ ttlMs: 1000, agora: () => agora.t });
    expect(c.obter("a")).toBeNull();
    c.guardar("a", "x");
    expect(c.obter("a")).toBe("x");
    expect(c.stats()).toMatchObject({ hits: 1, misses: 1, tamanho: 1 });
  });

  it("expiração: TTL curto com relógio injetado", () => {
    const agora = { t: 0 };
    const c = criarCache<string>({ ttlMs: 100, agora: () => agora.t });
    c.guardar("a", "x");
    agora.t = 99;
    expect(c.obter("a")).toBe("x");
    agora.t = 100;
    expect(c.obter("a")).toBeNull();
    expect(c.stats().tamanho).toBe(0);
  });

  it("invalidação unitária e total", () => {
    const c = criarCache<string>({ ttlMs: 60000 });
    c.guardar("a", "x");
    c.guardar("b", "y");
    expect(c.invalidar("a")).toBe(true);
    expect(c.obter("a")).toBeNull();
    expect(c.invalidar("ausente")).toBe(false);
    c.invalidarTudo();
    expect(c.stats().tamanho).toBe(0);
  });
});

describe("ttlCuponsMs", () => {
  const anterior = process.env.CUPOM_CACHE_TTL_MS;
  afterEach(() => {
    if (anterior === undefined) delete process.env.CUPOM_CACHE_TTL_MS;
    else process.env.CUPOM_CACHE_TTL_MS = anterior;
  });

  it("padrão 5 minutos sem env", () => {
    delete process.env.CUPOM_CACHE_TTL_MS;
    expect(TTL_PADRAO_MS).toBe(5 * 60 * 1000);
    expect(ttlCuponsMs()).toBe(5 * 60 * 1000);
  });

  it("env configurável; inválido cai no padrão", () => {
    process.env.CUPOM_CACHE_TTL_MS = "30000";
    expect(ttlCuponsMs()).toBe(30000);
    process.env.CUPOM_CACHE_TTL_MS = "lixo";
    expect(ttlCuponsMs()).toBe(5 * 60 * 1000);
  });
});

describe("obterCupom", () => {
  it("miss busca no banco e guarda ilimitado", async () => {
    const buscar = vi.fn(async () => cupomLinha());
    const r1 = await obterCupom("teste10", buscar);
    expect(r1.origem).toBe("banco");
    expect(buscar).toHaveBeenCalledTimes(1);
    const r2 = await obterCupom("TESTE10", buscar);
    expect(r2.origem).toBe("cache");
    expect(buscar).toHaveBeenCalledTimes(1);
    invalidarCupom("TESTE10");
  });

  it("com limite (maxUses) nunca guarda: sempre banco", async () => {
    const buscar = vi.fn(async () => cupomLinha({ maxUses: 100 }));
    await obterCupom("LIMITADO", buscar);
    await obterCupom("LIMITADO", buscar);
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("invalidação força nova leitura", async () => {
    const buscar = vi.fn(async () => cupomLinha({ code: "INV" }));
    await obterCupom("INV", buscar);
    invalidarCupom("INV");
    await obterCupom("INV", buscar);
    expect(buscar).toHaveBeenCalledTimes(2);
    invalidarCupom("INV");
  });

  it("ausente no banco: null sem guardar", async () => {
    const buscar = vi.fn(async () => null);
    const r = await obterCupom("FANTASMA", buscar);
    expect(r).toEqual({ cupom: null, origem: "banco" });
    expect(estatisticasCupomCache().tamanho).toBe(0);
  });
});
