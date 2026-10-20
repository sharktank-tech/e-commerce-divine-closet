import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assinarEvento, notificarErp, verificarAssinaturaErp } from "@/lib/erp";

// Fila ERP em memória — enough p/ enfileirar → entregar → atualizar.
type Linha = {
  id: string;
  tipo: string;
  payload: unknown;
  status: string;
  attempt: number;
  nextAttemptAt: Date;
  createdAt: Date;
  lastStatusCode: number | null;
  lastError: string | null;
};

const { fila, erpEventMock } = vi.hoisted(() => {
  const fila = new Map<string, Record<string, unknown>>();
  const erpEventMock = {
    createMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  };
  return { fila, erpEventMock };
});

vi.mock("@/lib/prisma", () => ({ prisma: { erpEvent: erpEventMock } }));

function ligarFila() {
  erpEventMock.createMany.mockImplementation(
    async ({ data }: { data: Array<Record<string, unknown>> }) => {
      const d = data[0];
      if (fila.has(d.id as string)) return { count: 0 };
      const linha = {
        ...d,
        lastStatusCode: null,
        lastError: null,
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        version: 1,
      };
      fila.set(d.id as string, linha);
      return { count: 1 };
    }
  );
  erpEventMock.findUnique.mockImplementation(
    async ({ where }: { where: { id: string } }) => fila.get(where.id) ?? null
  );
  erpEventMock.updateMany.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const linha = fila.get(where.id);
      if (!linha) return { count: 0 };
      Object.assign(linha, data);
      return { count: 1 };
    }
  );
}

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
  beforeEach(() => {
    fila.clear();
    vi.clearAllMocks();
    ligarFila();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["ERP_WEBHOOK_URL", "ERP_WEBHOOK_SECRET"]) delete process.env[k];
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("sem config: não envia (false), sem fetch — mas PERSISTE na fila", async () => {
    delete process.env.ERP_WEBHOOK_URL;
    delete process.env.ERP_WEBHOOK_SECRET;
    delete process.env.NEXT_PUBLIC_APP_URL;
    const fetchSpy = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await notificarErp("pedido_criado", { numero: "1" })).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    // fila é fonte de verdade mesmo com ERP desativado (histórico intacto;
    // a entrega acontece quando houver URL+segredo, via dreno)
    expect(erpEventMock.createMany).toHaveBeenCalledTimes(1);
    expect([...fila.values()][0].status).toBe("PENDING");
  });

  it("sucesso de primeira: persiste na fila e envia 1x com assinatura", async () => {
    process.env.ERP_WEBHOOK_URL = "https://erp.local/hooks";
    process.env.ERP_WEBHOOK_SECRET = "s3";
    let corpo: Record<string, unknown> = {};
    let headers: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
        headers = init.headers;
        corpo = JSON.parse(init.body);
        return { ok: true, status: 200 };
      })
    );
    expect(await notificarErp("pedido_pago", { numero: "DC-1" })).toBe(true);
    // persistiu ANTES de enviar (fila = fonte de verdade)
    expect(erpEventMock.createMany).toHaveBeenCalledTimes(1);
    expect(corpo.tipo).toBe("pedido_pago");
    expect(corpo.versao).toBe(1);
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
    // fila marcada como entregue
    expect([...fila.values()][0].status).toBe("DELIVERED");
  });

  it("falha 2x e acerta: 3 tentativas internas e fila reprograma (backoff)", async () => {
    process.env.ERP_WEBHOOK_URL = "https://erp.local/hooks";
    process.env.ERP_WEBHOOK_SECRET = "s3";
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await notificarErp("estoque_atualizado", {})).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const linha = [...fila.values()][0];
    expect(linha.status).toBe("PENDING");
    expect(linha.attempt).toBe(1);
    expect(linha.lastStatusCode).toBe(500);
    expect((linha.nextAttemptAt as Date).getTime()).toBeGreaterThan(Date.now());
  });
});
