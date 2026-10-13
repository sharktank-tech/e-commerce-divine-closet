import { describe, expect, it, vi, afterEach } from "vitest";
import {
  assinarEvento,
  notificarErp,
  verificarAssinaturaErp,
} from "@/lib/erp";

describe("assinatura ERP", () => {
  it("assina e verifica; adulterado falha", () => {
    const corpo = JSON.stringify({ a: 1 });
    const v1 = assinarEvento(corpo, 123, "segredo");
    expect(verificarAssinaturaErp(corpo, "123", v1, "segredo")).toBe(true);
    expect(verificarAssinaturaErp(corpo + "x", "123", v1, "segredo")).toBe(false);
    expect(verificarAssinaturaErp(corpo, "123", v1, "outro")).toBe(false);
    expect(verificarAssinaturaErp(corpo, "", v1, "segredo")).toBe(false);
  });
});

describe("notificarErp", () => {
  const envAnterior = { ...process.env };

  function definirEnv(vars: Record<string, string | undefined>) {
    delete process.env.ERP_WEBHOOK_URL;
    delete process.env.ERP_WEBHOOK_SECRET;
    for (const [k, v] of Object.entries(vars)) {
      if (v !== undefined) process.env[k] = v;
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["ERP_WEBHOOK_URL", "ERP_WEBHOOK_SECRET"]) delete process.env[k];
    Object.assign(process.env, envAnterior);
  });

  it("sem config: não envia (false), sem fetch", async () => {
    definirEnv({});
    const fetchSpy = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await notificarErp("pedido_criado", { numero: "1" })).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sucesso de primeira: 1 chamada com assinatura e event_id", async () => {
    definirEnv({ ERP_WEBHOOK_URL: "https://erp.local/hooks", ERP_WEBHOOK_SECRET: "s3" });
    let corpo: Record<string, unknown> = {};
    let headers: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
        headers = init.headers;
        corpo = JSON.parse(init.body);
        return { ok: true };
      })
    );
    expect(await notificarErp("pedido_pago", { numero: "DC-1" })).toBe(true);
    expect(corpo.tipo).toBe("pedido_pago");
    expect(typeof corpo.event_id).toBe("string");
    expect(headers["x-erp-evento"]).toBe("pedido_pago");
    expect(
      verificarAssinaturaErp(
        JSON.stringify({ ...corpo }),
        headers["x-erp-ts"],
        (headers["x-erp-assinatura"] || "").replace("v1=", ""),
        "s3"
      )
    ).toBe(true);
  });

  it("falha 2x e acerta: 3 tentativas (retry)", async () => {
    definirEnv({ ERP_WEBHOOK_URL: "https://erp.local/hooks", ERP_WEBHOOK_SECRET: "s3" });
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await notificarErp("estoque_atualizado", {})).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
