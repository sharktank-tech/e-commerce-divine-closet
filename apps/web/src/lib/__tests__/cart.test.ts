import { describe, expect, it } from "vitest";
import { formatCartCount } from "../cart";

describe("formatCartCount", () => {
  it("oculta o badge quando zerado", () => {
    expect(formatCartCount(0)).toBeNull();
  });

  it("trata valores inválidos como zero", () => {
    expect(formatCartCount(NaN)).toBeNull();
    expect(formatCartCount(-3)).toBeNull();
  });

  it("exibe o número exato de 1 a 9", () => {
    expect(formatCartCount(1)).toBe("1");
    expect(formatCartCount(3)).toBe("3");
    expect(formatCartCount(9)).toBe("9");
  });

  it("limita a 9+ acima de 9 (soma de quantidades)", () => {
    expect(formatCartCount(10)).toBe("9+");
    expect(formatCartCount(99)).toBe("9+");
  });

  it("arredonda frações para baixo", () => {
    expect(formatCartCount(2.9)).toBe("2");
  });
});
