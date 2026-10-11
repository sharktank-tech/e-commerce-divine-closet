import { describe, expect, it } from "vitest";
import { chaveIp, verificarLimite } from "@/lib/rate-limit";

describe("verificarLimite", () => {
  it("permite até o máximo e bloqueia depois", () => {
    const agora = 1_000_000;
    const faixa = { janelaMs: 60_000, maximo: 3 };
    expect(verificarLimite("t1", faixa, agora).permitido).toBe(true);
    expect(verificarLimite("t1", faixa, agora).permitido).toBe(true);
    const r = verificarLimite("t1", faixa, agora);
    expect(r.permitido).toBe(true);
    expect(r.restantes).toBe(0);
    const bloqueado = verificarLimite("t1", faixa, agora);
    expect(bloqueado.permitido).toBe(false);
    expect(bloqueado.restantes).toBe(0);
  });

  it("janela expirada zera o contador", () => {
    const faixa = { janelaMs: 1_000, maximo: 1 };
    expect(verificarLimite("t2", faixa, 0).permitido).toBe(true);
    expect(verificarLimite("t2", faixa, 500).permitido).toBe(false);
    expect(verificarLimite("t2", faixa, 1_000).permitido).toBe(true);
  });

  it("chaves independentes", () => {
    const faixa = { janelaMs: 60_000, maximo: 1 };
    expect(verificarLimite("a", faixa, 0).permitido).toBe(true);
    expect(verificarLimite("b", faixa, 0).permitido).toBe(true);
    expect(verificarLimite("a", faixa, 0).permitido).toBe(false);
  });
});

describe("chaveIp", () => {
  const req = (headers: Record<string, string>) =>
    ({ headers: { get: (k: string) => headers[k] ?? null } }) as unknown as Request;

  it("prefere x-forwarded-for (primeiro IP)", () => {
    expect(
      chaveIp(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }), "login")
    ).toBe("login:1.2.3.4");
  });

  it("cai para desconhecido sem headers", () => {
    expect(chaveIp(req({}), "login")).toBe("login:desconhecido");
  });
});
