import { it, expect, vi, afterEach } from "vitest";
import { marketingToken, tokenMatches } from "@/lib/marketing/tokens";
import { summarizeSales } from "@/lib/marketing/metrics";
afterEach(() => vi.unstubAllEnvs());
it("token opaco é separado por finalidade, rotação de segredo invalida", () => {
  vi.stubEnv("JWT_SECRET", "local-test-secret-at-least-32-characters");
  const id = "00000000-0000-4000-8000-000000000001";
  const t = marketingToken(id, "v1", "confirm");
  expect(t).not.toContain("@");
  expect(tokenMatches(t, id, "v1", "confirm")).toBe(true);
  expect(tokenMatches(t, id, "v1", "unsubscribe")).toBe(false);
  vi.stubEnv("JWT_SECRET", "another-test-secret-at-least-32-characters");
  expect(tokenMatches(t, id, "v1", "confirm")).toBe(false);
});
it("decimais, estorno parcial, rejeitado e origem desconhecida", () => {
  const sale = (total: string, status: string, amount: string) => ({
    total,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    refund: { status, amount },
  });
  const m = summarizeSales([
    sale("0.10", "APPROVED", "0.03"),
    sale("0.20", "REJECTED", "0.20"),
  ]);
  expect(m.receitaBruta).toBe(0.3);
  expect(m.valoresEstornados).toBe(0.03);
  expect(m.receitaAposEstornos).toBe(0.27);
  expect(m.vendasPorOrigem[0].origem).toBe("origem desconhecida");
});
