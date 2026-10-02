import { describe, expect, it } from "vitest";
import {
  elegibilidadeCupom,
  type CupomElegibilidade,
} from "@/lib/elegibilidade-cupom";

const AGORA = new Date("2026-10-02T12:00:00Z");

function cupom(
  override: Partial<Exclude<CupomElegibilidade, null>> = {}
): Exclude<CupomElegibilidade, null> {
  return {
    active: true,
    deletedAt: null,
    startsAt: new Date("2026-01-01T00:00:00Z"),
    endsAt: null,
    maxUses: null,
    usedCount: 0,
    minSubtotal: null,
    ...override,
  };
}

describe("elegibilidadeCupom", () => {
  it("código inexistente: inelegível", () => {
    expect(elegibilidadeCupom(null, AGORA, 150)).toEqual({
      elegivel: false,
      motivo: "inexistente",
    });
  });

  it("válido dentro do mínimo: elegível", () => {
    expect(
      elegibilidadeCupom(cupom({ minSubtotal: 100 }), AGORA, 150)
    ).toEqual({ elegivel: true });
  });

  it("exatamente no mínimo: elegível (borda inclusiva)", () => {
    expect(
      elegibilidadeCupom(cupom({ minSubtotal: 100 }), AGORA, 100)
    ).toEqual({ elegivel: true });
  });

  it("abaixo do mínimo: rejeitado com motivo minimo", () => {
    expect(
      elegibilidadeCupom(cupom({ minSubtotal: 100 }), AGORA, 99.99)
    ).toEqual({ elegivel: false, motivo: "minimo" });
  });

  it("expirado (endsAt no passado): rejeitado", () => {
    expect(
      elegibilidadeCupom(
        cupom({ endsAt: new Date("2026-09-01T00:00:00Z") }),
        AGORA,
        500
      )
    ).toEqual({ elegivel: false, motivo: "expirado" });
  });

  it("ainda não iniciado (startsAt no futuro): rejeitado", () => {
    expect(
      elegibilidadeCupom(
        cupom({ startsAt: new Date("2026-12-01T00:00:00Z") }),
        AGORA,
        500
      )
    ).toEqual({ elegivel: false, motivo: "nao_iniciado" });
  });

  it("inativo ou soft-deletado: rejeitado", () => {
    expect(elegibilidadeCupom(cupom({ active: false }), AGORA, 500)).toEqual({
      elegivel: false,
      motivo: "inativo",
    });
    expect(
      elegibilidadeCupom(
        cupom({ deletedAt: new Date("2026-09-01T00:00:00Z") }),
        AGORA,
        500
      )
    ).toEqual({ elegivel: false, motivo: "inativo" });
  });

  it("uso único já utilizado (maxUses 1 + usedCount 1): rejeitado", () => {
    expect(
      elegibilidadeCupom(cupom({ maxUses: 1, usedCount: 1 }), AGORA, 500)
    ).toEqual({ elegivel: false, motivo: "esgotado" });
  });

  it("uso único ainda não utilizado: elegível", () => {
    expect(
      elegibilidadeCupom(cupom({ maxUses: 1, usedCount: 0 }), AGORA, 500)
    ).toEqual({ elegivel: true });
  });

  it("expirado e abaixo do mínimo: expiração prevalece (ordem das regras)", () => {
    expect(
      elegibilidadeCupom(
        cupom({
          endsAt: new Date("2026-09-01T00:00:00Z"),
          minSubtotal: 100,
        }),
        AGORA,
        10
      )
    ).toEqual({ elegivel: false, motivo: "expirado" });
  });
});
