import { beforeEach, describe, expect, it, vi } from "vitest";

// Rota GET /api/pedidos: sessão obrigatória + isolamento entre contas
// (propriedade do pedido preservada) + campos de rastreio no payload.
const { prismaMock, getSessionMock } = vi.hoisted(() => ({
  prismaMock: { order: { findMany: vi.fn() } },
  getSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth")>();
  return { ...original, getSession: getSessionMock };
});

import { GET } from "@/app/api/pedidos/route";

const req = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/pedidos", () => {
  it("sem sessão → 401 (não vaza pedidos)", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(prismaMock.order.findMany).not.toHaveBeenCalled();
  });

  it("busca somente pedidos do próprio usuário (posse)", async () => {
    getSessionMock.mockResolvedValue({ sub: "user-1", role: "CLIENT" });
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: "o1",
        number: "DC-1",
        status: "SHIPPED",
        trackingCode: "BR123",
        trackingCarrier: "correios",
        trackingUrl: "https://rastreamento.correios.com.br/app/index.php",
        items: [],
        address: null,
      },
    ]);

    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(prismaMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } })
    );
    const body = await res.json();
    expect(body.orders[0]).toMatchObject({
      trackingCode: "BR123",
      trackingCarrier: "correios",
      trackingUrl: "https://rastreamento.correios.com.br/app/index.php",
    });
  });
});
