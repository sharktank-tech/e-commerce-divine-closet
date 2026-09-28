import { describe, expect, it } from "vitest";
import { slugify } from "../utils";

describe("slugify", () => {
  it("gera slug limpo a partir do nome", () => {
    expect(slugify("Vestido Pietra")).toBe("vestido-pietra");
  });

  it("remove acentos", () => {
    expect(slugify("Calça Jeans Madu")).toBe("calca-jeans-madu");
    expect(slugify("Conjunto Açúcar")).toBe("conjunto-acucar");
  });

  it("troca separadores por hífen único e aparas", () => {
    expect(slugify("  Saia  &  Top  ")).toBe("saia-top");
    expect(slugify("Blusa--Yara")).toBe("blusa-yara");
  });

  it("nomes iguais geram o mesmo slug (colisão detectável)", () => {
    expect(slugify("Blusa Yara")).toBe(slugify("blusa yara"));
  });
});
