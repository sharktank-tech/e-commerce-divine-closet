import { describe, expect, it } from "vitest";
import { interpretGa4HttpResult, submitGa4Refund } from "../ga4-transport";

describe("GA4 Measurement Protocol: transporte desativado por padrão", () => {
  it("nunca faz chamadas de rede mesmo com evento preparado", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("forbidden");
    }) as typeof fetch;
    try {
      const result = await submitGa4Refund({
        clientId: "123456.789012",
        event: {
          name: "refund",
          params: {
            transaction_id: "6fda65c2-7a90-4f18-88e8-1878f5a4c5de",
            currency: "BRL",
            value: 20,
            shipping: 0,
            items: [],
          },
        },
      });
      expect(result).toEqual({ kind: "DISABLED" });
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("não confunde HTTP 204 com processamento comprovado", () => {
    expect(interpretGa4HttpResult(204)).toEqual({ kind: "ACCEPTED_UNVERIFIED" });
  });
  it("preserva incerteza quando a resposta se perde", () => {
    expect(interpretGa4HttpResult(null)).toEqual({ kind: "UNCERTAIN" });
  });
  it("identifica rejeição de transporte", () => {
    expect(interpretGa4HttpResult(500)).toEqual({ kind: "REJECTED" });
  });
});
