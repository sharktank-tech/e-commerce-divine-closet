import { describe, expect, it, vi, beforeEach } from "vitest";

// Rate-limit em Postgres (tabela RateLimit): janela fixa com início
// arredondado; upsert incrementa; IP extraído só de headers confiáveis.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { rateLimit: { upsert: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { consumirRateLimit, ipDoPedido } from "@/lib/rate-limit";

beforeEach(() => {
  prismaMock.rateLimit.upsert.mockReset();
});

describe("consumirRateLimit", () => {
  const agora = new Date("2026-10-17T10:37:00Z");
  const janelaEsperada = new Date("2026-10-17T10:00:00Z"); // janela de 60min arredondada p/ hora cheia

  it("primeira tentativa (total=1) → permitido, restantes = limite-1", async () => {
    prismaMock.rateLimit.upsert.mockResolvedValue({ total: 1 });
    const r = await consumirRateLimit("reenviar:ip:1.2.3.4", { limite: 10, agora });
    expect(r).toEqual({ permitido: true, restantes: 9 });
    expect(prismaMock.rateLimit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chave_janelaInicio: { chave: "reenviar:ip:1.2.3.4", janelaInicio: janelaEsperada } },
        create: { chave: "reenviar:ip:1.2.3.4", janelaInicio: janelaEsperada, total: 1 },
        update: { total: { increment: 1 } },
      })
    );
  });

  it("total exatamente no limite → ainda permitido; acima → bloqueado com restantes 0", async () => {
    prismaMock.rateLimit.upsert.mockResolvedValue({ total: 10 });
    expect(await consumirRateLimit("k", { limite: 10, agora })).toEqual({ permitido: true, restantes: 0 });

    prismaMock.rateLimit.upsert.mockResolvedValue({ total: 11 });
    expect(await consumirRateLimit("k", { limite: 10, agora })).toEqual({ permitido: false, restantes: 0 });
  });

  it("janela customizada arredonda o início para o múltiplo correto", async () => {
    prismaMock.rateLimit.upsert.mockResolvedValue({ total: 1 });
    await consumirRateLimit("k", { limite: 5, janelaMin: 15, agora });
    // 10:37 → floor para 10:30 (múltiplo de 15min)
    expect(prismaMock.rateLimit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chave_janelaInicio: { chave: "k", janelaInicio: new Date("2026-10-17T10:30:00Z") } },
      })
    );
  });
});

describe("ipDoPedido", () => {
  it("prefere x-real-ip (gravado pelo edge, não spoofável)", () => {
    const h = new Headers({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "9.9.9.9, 1.1.1.1" });
    expect(ipDoPedido(h)).toBe("203.0.113.9");
  });

  it("fallback: primeiro hop do x-forwarded-for; sem headers → 'desconhecido'", () => {
    const h = new Headers({ "x-forwarded-for": "9.9.9.9, 1.1.1.1" });
    expect(ipDoPedido(h)).toBe("9.9.9.9");
    expect(ipDoPedido(new Headers())).toBe("desconhecido");
  });

  it("trunca valores absurdos (não vira vetor de exaustão da PK)", () => {
    const longo = "a".repeat(300);
    const h = new Headers({ "x-real-ip": longo });
    expect(ipDoPedido(h)).toHaveLength(64);
  });
});
