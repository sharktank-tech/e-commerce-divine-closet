import { describe, expect, it } from "vitest";
import { chaveIp, naVez, verificarLimite } from "@/lib/rate-limit";

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

describe("chaveIp", () => {  const req = (headers: Record<string, string>) =>
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

describe("naVez", () => {
  it("serializa tarefas da mesma chave (check-then-act sem corrida)", async () => {
    let vistos: number[] = [];
    let contador = 0;
    const tarefa = () =>
      naVez("fila-teste", async () => {
        const lido = contador;
        await new Promise((r) => setTimeout(r, 5));
        contador = lido + 1;
        vistos.push(contador);
        return contador;
      });
    const resultados = await Promise.all(Array.from({ length: 10 }, tarefa));
    expect(contador).toBe(10);
    expect(resultados).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("erro numa tarefa não trava a fila", async () => {
    const boom = () =>
      naVez("fila-erro", async () => {
        throw new Error("x");
      });
    await expect(boom()).rejects.toThrow("x");
    expect(await naVez("fila-erro", async () => 42)).toBe(42);
  });

  it("chaves diferentes não se bloqueiam", async () => {
    const ordem: string[] = [];
    const lenta = () =>
      naVez("lenta", async () => {
        await new Promise((r) => setTimeout(r, 30));
        ordem.push("lenta");
      });
    const rapida = () =>
      naVez("rapida", async () => {
        ordem.push("rapida");
      });
    await Promise.all([lenta(), rapida()]);
    expect(ordem).toEqual(["rapida", "lenta"]);
  });
});
