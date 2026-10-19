import { describe, expect, it } from "vitest";
import { autorizarCron } from "@/lib/cron-auth";

// Rotas cron: token exato em tempo constante; sem secret a rota fica fechada.
describe("autorizarCron", () => {
  const SECRET = "segredo-longo-o-suficiente-0123456789";

  it("Bearer com o secret exato → autoriza", () => {
    expect(autorizarCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("secret errado → nega", () => {
    expect(autorizarCron("Bearer outro-segredo-comprido-0123456789", SECRET)).toBe(false);
  });

  it("token de tamanho diferente → nega (sem crash)", () => {
    expect(autorizarCron("Bearer x", SECRET)).toBe(false);
    expect(autorizarCron(`Bearer ${SECRET}${SECRET}`, SECRET)).toBe(false);
  });

  it("sem header, sem Bearer ou sem token → nega", () => {
    expect(autorizarCron(null, SECRET)).toBe(false);
    expect(autorizarCron("", SECRET)).toBe(false);
    expect(autorizarCron(SECRET, SECRET)).toBe(false);
    expect(autorizarCron("Bearer ", SECRET)).toBe(false);
  });

  it("CRON_SECRET ausente → nega até para o token 'correto' (rota desligada)", () => {
    expect(autorizarCron(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(autorizarCron(`Bearer ${SECRET}`, "")).toBe(false);
  });
});
