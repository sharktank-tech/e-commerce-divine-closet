import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fila ERP: dreno com backoff, esgotamento (DEAD), 4xx vs 5xx, idempotência
// e envelope versionado. O payload nunca é entregue sem assinatura.
const { fila, erpEventMock } = vi.hoisted(() => {
  const fila = new Map<string, Record<string, unknown>>();
  const erpEventMock = {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  };
  return { fila, erpEventMock };
});

vi.mock("@/lib/prisma", () => ({ prisma: { erpEvent: erpEventMock } }));

import {
  ERP_MAX_TENTATIVAS,
  drenarEventosErp,
  enfileirarEvento,
  entregarEvento,
  erpConfigurado,
  verificarAssinaturaErp,
} from "@/lib/erp";

function ligarFila() {
  erpEventMock.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if (fila.has(data.id as string)) {
      throw Object.assign(new Error("dup"), { code: "P2002" });
    }
    const linha = {
      ...data,
      lastStatusCode: null,
      lastError: null,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      version: 1,
    };
    fila.set(data.id as string, linha);
    return linha;
  });
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
  erpEventMock.findMany.mockImplementation(
    async ({
      where,
      take,
    }: {
      where: { status: { in: string[] }; nextAttemptAt?: { lte: Date } };
      take?: number;
    }) => {
      const alvo = where.status.in;
      const limite = where.nextAttemptAt?.lte ?? new Date();
      return [...fila.values()]
        .filter(
          (l) =>
            alvo.includes(l.status as string) &&
            (l.nextAttemptAt as Date).getTime() <= limite.getTime()
        )
        .slice(0, take ?? 100);
    }
  );
}

function definirConfig() {
  process.env.ERP_WEBHOOK_URL = "https://erp.local/hooks";
  process.env.ERP_WEBHOOK_SECRET = "s3";
}

function semConfig() {
  delete process.env.ERP_WEBHOOK_URL;
  delete process.env.ERP_WEBHOOK_SECRET;
  delete process.env.NEXT_PUBLIC_APP_URL;
}

beforeEach(() => {
  fila.clear();
  vi.clearAllMocks();
  ligarFila();
});

afterEach(() => {
  vi.unstubAllGlobals();
  semConfig();
});

describe("enfileirarEvento", () => {
  it("sem configuração: não persiste nada (desativado é o normal)", async () => {
    semConfig();
    expect(erpConfigurado()).toBe(false);
    expect(await enfileirarEvento("pedido_pago", { numero: "1" })).toBeNull();
    expect(erpEventMock.create).not.toHaveBeenCalled();
  });

  it("com config: grava PENDING e devolve o event_id", async () => {
    definirConfig();
    expect(erpConfigurado()).toBe(true);
    const id = await enfileirarEvento("pedido_criado", { numero: "DC-1" });
    expect(id).toBeTruthy();
    expect(erpEventMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id, tipo: "pedido_criado", status: "PENDING" }),
      })
    );
  });

  it("reenfileirar mesmo event_id (P2002) é idempotente", async () => {
    definirConfig();
    const id = await enfileirarEvento("pedido_pago", {});
    erpEventMock.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    const deNovo = await enfileirarEvento("pedido_pago", {});
    expect(typeof deNovo).toBe("string");
  });
});

describe("drenarEventosErp", () => {
  it("sem config: zero e sem query", async () => {
    semConfig();
    expect(await drenarEventosErp()).toEqual({ processados: 0, entregues: 0 });
    expect(erpEventMock.findMany).not.toHaveBeenCalled();
  });

  it("entrega pendentes vencidos, ignora futuros e mortos; envelope assinado", async () => {
    definirConfig();
    await enfileirarEvento("pedido_pago", { numero: "DC-9" });
    // outro evento ainda no futuro + um DEAD
    fila.set("futuro", {
      id: "futuro",
      tipo: "pedido_pago",
      payload: {},
      status: "PENDING",
      attempt: 1,
      nextAttemptAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      lastStatusCode: null,
      lastError: null,
    });
    fila.set("morto", {
      id: "morto",
      tipo: "pedido_pago",
      payload: {},
      status: "DEAD",
      attempt: ERP_MAX_TENTATIVAS,
      nextAttemptAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
      lastStatusCode: 500,
      lastError: "x",
    });

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

    const r = await drenarEventosErp();
    expect(r.processados).toBe(1);
    expect(r.entregues).toBe(1);
    expect((fila.values().next().value as { status: string }).status).toBe("DELIVERED");

    // contrato preservado + versão nova
    expect(corpo.event_id).toBeTruthy();
    expect(corpo.versao).toBe(1);
    expect(corpo.dados).toMatchObject({ numero: "DC-9" });
    expect(
      verificarAssinaturaErp(
        JSON.stringify(corpo),
        headers["x-erp-ts"],
        (headers["x-erp-assinatura"] || "").replace("v1=", ""),
        "s3"
      )
    ).toBe(true);
  });

  it("4xx → FAILED (rejeição), 5xx → PENDING; ambos reagendados com backoff", async () => {
    definirConfig();
    await enfileirarEvento("produto_criado", {});
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 422 })));
    await drenarEventosErp();
    let linha = [...fila.values()][0];
    expect(linha.status).toBe("FAILED");
    expect(linha.attempt).toBe(1);
    expect((linha.nextAttemptAt as Date).getTime()).toBeGreaterThan(Date.now());

    fila.clear();
    await enfileirarEvento("produto_atualizado", {});
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    await drenarEventosErp();
    linha = [...fila.values()][0];
    expect(linha.status).toBe("PENDING");
    expect(linha.lastStatusCode).toBe(503);
  });

  it(`esgota em ${ERP_MAX_TENTATIVAS} tentativas → DEAD (nunca retry infinito)`, async () => {
    definirConfig();
    await enfileirarEvento("pedido_cancelado", { numero: "DC-2" });
    const linha = [...fila.values()][0];
    linha.attempt = ERP_MAX_TENTATIVAS - 1;
    linha.status = "PENDING";
    linha.nextAttemptAt = new Date(Date.now() - 1000);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));

    const r = await drenarEventosErp();
    expect(r.entregues).toBe(0);
    expect(linha.status).toBe("DEAD");
    expect(linha.attempt).toBe(ERP_MAX_TENTATIVAS);
  });
});

describe("entregarEvento", () => {
  it("não entrega duas vezes (guarda DELIVERED) nem sem estar na hora", async () => {
    definirConfig();
    await enfileirarEvento("pedido_pago", {});
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    expect(await entregarEvento([...fila.values()][0].id as string)).toBe(true);
    expect(await entregarEvento([...fila.values()][0].id as string)).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // evento reagendado para o futuro: entrega não avança
    fila.clear();
    await enfileirarEvento("pedido_pago", {});
    const l = [...fila.values()][0];
    l.nextAttemptAt = new Date(Date.now() + 60_000);
    expect(await entregarEvento(l.id as string)).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("id inexistente → false sem fetch", async () => {
    definirConfig();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await entregarEvento("nao-existe")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
