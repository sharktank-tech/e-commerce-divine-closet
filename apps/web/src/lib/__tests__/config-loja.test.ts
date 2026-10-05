import { describe, expect, it, vi } from "vitest";
import { getEmpresa, getFrete, getPagamento } from "@/lib/config-loja";

function bancoFake(gravado: Record<string, string>) {
  return {
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        const value = gravado[where.key];
        return value === undefined ? null : { value };
      }),
    },
  };
}

describe("config-loja", () => {
  it("sem nada gravado: defaults", async () => {
    const db = bancoFake({});
    expect(await getEmpresa(db)).toMatchObject({ name: "Divine Closet" });
    expect(await getFrete(db)).toMatchObject({ fixed: 20, freeFrom: 300 });
    expect(await getPagamento(db)).toMatchObject({ card: true, pix: true, boleto: true });
  });

  it("gravado vence o padrão (mescla parcial)", async () => {
    const db = bancoFake({
      empresa: JSON.stringify({ name: "Loja Teste", phone: "(21) 9999-0000" }),
      frete: JSON.stringify({ fixed: 15 }),
      pagamento: JSON.stringify({ boleto: false }),
    });
    expect(await getEmpresa(db)).toMatchObject({
      name: "Loja Teste",
      phone: "(21) 9999-0000",
      email: "contato@divinecloset.com",
    });
    expect(await getFrete(db)).toMatchObject({ fixed: 15, freeFrom: 300 });
    expect(await getPagamento(db)).toMatchObject({ card: true, boleto: false });
  });

  it("JSON corrompido: cai no padrão sem quebrar", async () => {
    const db = bancoFake({ frete: "não-é-json" });
    expect(await getFrete(db)).toMatchObject({ fixed: 20, freeFrom: 300 });
  });
});
