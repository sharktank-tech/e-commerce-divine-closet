import { beforeEach, describe, expect, it, vi } from "vitest";

// Acompanhamento de convidado: hash-only, rotação no reenvio, limite de
// envios, resposta genérica idêntica (anti-enumeração) e página pública
// sem dados pessoais.
const { prismaMock, sendEmailMock } = vi.hoisted(() => ({
  prismaMock: {
    order: { findUnique: vi.fn(), findMany: vi.fn() },
    orderTrackToken: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    rateLimit: { upsert: vi.fn() },
  },
  sendEmailMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/email", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/email")>();
  return { ...original, sendEmail: sendEmailMock };
});

import {
  ACOMPANHAMENTO_TTL_DIAS,
  REENVIO_MAX,
  REENVIO_ESPERA_MIN,
  buscarPedidoPorToken,
  criarTokenAcompanhamento,
  emCooldown,
  formatoTokenValido,
  gerarToken,
  hashToken,
  linkAcompanhamento,
  processarReenvio,
  rotacionarToken,
  tokenAtivo,
} from "@/lib/pedidos/acompanhar";
import { POST } from "@/app/api/acompanhar/reenviar/route";

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    orderId: "o1",
    tokenHash: hashToken("x".repeat(43)),
    sentTo: "g@g.com",
    sendCount: 1,
    lastSentAt: new Date("2026-01-01"),
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    ...overrides,
  };
}

function reqJson(body: unknown) {
  return {
    json: async () => body,
    headers: new Headers({ "x-real-ip": "203.0.113.9" }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.orderTrackToken.create.mockResolvedValue({});
  prismaMock.orderTrackToken.update.mockResolvedValue({});
  // vi.clearAllMocks mantém impls antigas — zera o findUnique explicitamente
  prismaMock.orderTrackToken.findUnique.mockReset().mockResolvedValue(null);
  prismaMock.rateLimit.upsert.mockReset().mockResolvedValue({ total: 1 });
  sendEmailMock.mockReset().mockResolvedValue(undefined);
});

describe("token básico", () => {
  it("hash é SHA-256 estável; plaintext gerado é longo e url-safe", () => {
    const t = gerarToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toContain(t);
  });

  it("formatoTokenValido rejeita lixo (evita lookup no banco)", () => {
    expect(formatoTokenValido(gerarToken())).toBe(true);
    expect(formatoTokenValido("abc")).toBe(false);
    expect(formatoTokenValido("tem espaço e $")).toBe(false);
    expect(formatoTokenValido(null as unknown as string)).toBe(false);
  });

  it("link usa o base oficial", () => {
    expect(linkAcompanhamento("tok")).toMatch(
      /^https:\/\/(www\.)?divinecloset\.com\.br\/acompanhar\/tok$/
    );
  });

  it("tokenAtivo: revogado ou expirado → inativo; TTL de 30 dias", () => {
    expect(ACOMPANHAMENTO_TTL_DIAS).toBe(30);
    expect(tokenAtivo(tokenRow())).toBe(true);
    expect(tokenAtivo(tokenRow({ revokedAt: new Date() }))).toBe(false);
    expect(tokenAtivo(tokenRow({ expiresAt: new Date(Date.now() - 1000) }))).toBe(false);
  });

  it("emCooldown: limite de envios ou espera de 10 min", () => {
    expect(REENVIO_MAX).toBe(5);
    expect(REENVIO_ESPERA_MIN).toBe(10);
    expect(emCooldown(tokenRow({ sendCount: REENVIO_MAX }))).toBe(true);
    expect(
      emCooldown(tokenRow({ lastSentAt: new Date(Date.now() - 60_000) }))
    ).toBe(true);
    expect(
      emCooldown(tokenRow({ sendCount: 1, lastSentAt: new Date(Date.now() - 11 * 60_000) }))
    ).toBe(false);
  });
});

describe("buscarPedidoPorToken", () => {
  it("formato inválido → null sem consultar o banco", async () => {
    expect(await buscarPedidoPorToken("curto")).toBeNull();
    expect(prismaMock.orderTrackToken.findUnique).not.toHaveBeenCalled();
  });

  it("hash desconhecido, revogado ou expirado → null", async () => {
    prismaMock.orderTrackToken.findUnique.mockResolvedValue(null);
    expect(await buscarPedidoPorToken(gerarToken())).toBeNull();

    prismaMock.orderTrackToken.findUnique.mockResolvedValue(
      tokenRow({ revokedAt: new Date() })
    );
    expect(await buscarPedidoPorToken(gerarToken())).toBeNull();

    prismaMock.orderTrackToken.findUnique.mockResolvedValue(
      tokenRow({ expiresAt: new Date(Date.now() - 1000) })
    );
    expect(await buscarPedidoPorToken(gerarToken())).toBeNull();
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
  });

  it("token válido → consulta pelo HASH e devolve só dados públicos", async () => {
    const token = gerarToken();
    prismaMock.orderTrackToken.findUnique.mockResolvedValue(
      tokenRow({ tokenHash: hashToken(token) })
    );
    prismaMock.order.findUnique.mockResolvedValue({
      number: "DC-1",
      status: "SHIPPED",
      paymentStatus: "PAID",
      total: "199.90",
      createdAt: new Date("2026-01-02"),
      trackingCode: "BR1",
      trackingCarrier: "correios",
      trackingUrl: null,
      items: [{ productName: "Blusa", quantity: 1, size: "M" }],
      guestEmail: "g@g.com",
      guestName: "Convidada",
      address: { street: "Rua X" },
    });

    const dados = await buscarPedidoPorToken(token);
    expect(dados).not.toBeNull();
    expect(prismaMock.orderTrackToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashToken(token) },
    });
    expect(prismaMock.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "o1" } })
    );
    // nunca vaza dados pessoais
    expect(dados && Object.keys(dados)).not.toContain("guestEmail");
    expect(JSON.stringify(dados)).not.toContain("g@g.com");
    expect(JSON.stringify(dados)).not.toContain("Rua X");
    expect(dados?.number).toBe("DC-1");
    expect(dados?.trackingCode).toBe("BR1");
  });
});

describe("criarTokenAcompanhamento", () => {
  it("sem token → cria e devolve plaintext", async () => {
    prismaMock.orderTrackToken.findUnique.mockResolvedValue(null);
    const token = await criarTokenAcompanhamento({ orderId: "o1", sentTo: "g@g.com" });
    expect(token).toBeTruthy();
    expect(prismaMock.orderTrackToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: "o1",
          tokenHash: hashToken(token!),
          sentTo: "g@g.com",
          sendCount: 1,
        }),
      })
    );
  });

  it("token ativo já existe → null (não duplica link)", async () => {
    prismaMock.orderTrackToken.findUnique.mockResolvedValue(tokenRow());
    expect(await criarTokenAcompanhamento({ orderId: "o1" })).toBeNull();
    expect(prismaMock.orderTrackToken.create).not.toHaveBeenCalled();
    expect(prismaMock.orderTrackToken.update).not.toHaveBeenCalled();
  });

  it("token expirado → rotaciona (update)", async () => {
    prismaMock.orderTrackToken.findUnique.mockResolvedValue(
      tokenRow({ expiresAt: new Date(Date.now() - 1000) })
    );
    const token = await criarTokenAcompanhamento({ orderId: "o1" });
    expect(token).toBeTruthy();
    expect(prismaMock.orderTrackToken.update).toHaveBeenCalled();
    expect(prismaMock.orderTrackToken.create).not.toHaveBeenCalled();
  });
});

describe("processarReenvio", () => {
  it("sem pedidos → não envia (resposta segue aceita)", async () => {
    prismaMock.order.findMany.mockResolvedValue([]);
    const r = await processarReenvio({ email: "nada@nada.com" });
    expect(r).toMatchObject({ aceito: true, enviou: false, links: [] });
  });

  it("pedidos convidado → rotaciona tokens (sendCount+1) e monta links", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      { id: "o1", number: "DC-1", trackToken: tokenRow({ sendCount: 1 }) },
      { id: "o2", number: "DC-2", trackToken: null },
    ]);
    // o1 já tem token (rotaciona → update); o2 não tem (create)
    prismaMock.orderTrackToken.findUnique.mockImplementation(
      async (args: { where: { orderId: string } }) =>
        args.where.orderId === "o1" ? tokenRow({ sendCount: 1 }) : null
    );
    const r = await processarReenvio({ email: "G@G.com" });
    expect(r.enviou).toBe(true);
    expect(r.links).toHaveLength(2);
    expect(r.links[0].url).toMatch(/\/acompanhar\/[A-Za-z0-9_-]{43}$/);
    expect(prismaMock.orderTrackToken.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.orderTrackToken.create).toHaveBeenCalledTimes(1);
    // busca com email normalizado
    expect(prismaMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ guestEmail: "g@g.com", userId: null }),
      })
    );
  });

  it("qualquer token do email em espera (10 min) → não envia nada", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      { id: "o1", number: "DC-1", trackToken: null },
      {
        id: "o2",
        number: "DC-2",
        trackToken: tokenRow({ lastSentAt: new Date(Date.now() - 60_000) }),
      },
    ]);
    const r = await processarReenvio({ email: "g@g.com" });
    expect(r.enviou).toBe(false);
    expect(prismaMock.orderTrackToken.create).not.toHaveBeenCalled();
    expect(prismaMock.orderTrackToken.update).not.toHaveBeenCalled();
  });

  it("token no limite máximo de envios → não envia", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: "o1",
        number: "DC-1",
        trackToken: tokenRow({
          sendCount: REENVIO_MAX,
          lastSentAt: new Date(Date.now() - 60 * 60_000),
        }),
      },
    ]);
    const r = await processarReenvio({ email: "g@g.com" });
    expect(r.enviou).toBe(false);
  });

  it("limita a quantidade de pedidos por chamada", async () => {
    prismaMock.order.findMany.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => ({
        id: `o${i}`,
        number: `DC-${i}`,
        trackToken: null,
      }))
    );
    const r = await processarReenvio({ email: "g@g.com" });
    expect(prismaMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 })
    );
    expect(r.links).toHaveLength(5);
  });
});

describe("POST /api/acompanhar/reenviar", () => {
  it("email inválido → 400", async () => {
    const res = await POST(reqJson({ email: "nao-e-email" }));
    expect(res.status).toBe(400);
    expect(prismaMock.order.findMany).not.toHaveBeenCalled();
  });

  it("resposta GENÉRICA idêntica com e sem pedidos (anti-enumeração)", async () => {
    prismaMock.order.findMany.mockResolvedValue([]);
    const semPedidos = await POST(reqJson({ email: "x@x.com" }));
    const bodySem = await semPedidos.json();

    prismaMock.order.findMany.mockResolvedValue([
      { id: "o1", number: "DC-1", trackToken: null },
    ]);
    const comPedidos = await POST(reqJson({ email: "x@x.com" }));
    const bodyCom = await comPedidos.json();

    expect(semPedidos.status).toBe(200);
    expect(comPedidos.status).toBe(200);
    expect(bodyCom).toEqual(bodySem);
    expect(JSON.stringify(bodyCom)).not.toMatch(/DC-1|o1/);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("rate-limit por IP atingido → mesma resposta genérica, sem consulta nem envio", async () => {
    prismaMock.rateLimit.upsert.mockResolvedValue({ total: 99 });
    const res = await POST(reqJson({ email: "x@x.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mensagem).toMatch(/Se houver pedidos/);
    expect(prismaMock.order.findMany).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(prismaMock.rateLimit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chave_janelaInicio: expect.objectContaining({
            chave: "reenviar:ip:203.0.113.9",
          }),
        }),
      })
    );
  });
});
