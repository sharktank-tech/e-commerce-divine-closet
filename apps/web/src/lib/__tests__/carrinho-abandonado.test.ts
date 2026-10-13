import { describe, expect, it } from "vitest";
import { HORAS_ABANDONO, precisaLembrete } from "@/lib/carrinho-abandonado";

const AGORA = new Date("2026-10-12T12:00:00Z");
const hora = (h: number) => new Date(AGORA.getTime() - h * 3_600_000);

describe("precisaLembrete", () => {
  it("item recente: sem lembrete", () => {
    expect(precisaLembrete([hora(2)], null, AGORA)).toBe(false);
  });

  it("item com 30h: lembrete", () => {
    expect(precisaLembrete([hora(30)], null, AGORA)).toBe(true);
  });

  it("vale o item mais recente (adicionou algo há 1h, resto velho)", () => {
    expect(precisaLembrete([hora(50), hora(1)], null, AGORA)).toBe(false);
  });

  it("exatamente no limite (24h): lembrete", () => {
    expect(precisaLembrete([hora(HORAS_ABANDONO)], null, AGORA)).toBe(true);
  });

  it("já lembrado: nunca de novo", () => {
    expect(precisaLembrete([hora(100)], hora(50), AGORA)).toBe(false);
  });

  it("sem itens: sem lembrete", () => {
    expect(precisaLembrete([], null, AGORA)).toBe(false);
  });
});
