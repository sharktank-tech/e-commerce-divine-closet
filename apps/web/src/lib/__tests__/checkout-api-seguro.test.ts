import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock } = vi.hoisted(() => ({ prismaMock: { order: { findUnique: vi.fn(), create: vi.fn() } } }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), getSession: vi.fn().mockResolvedValue(null) }));
import { POST } from "@/app/api/pedidos/route";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const body = { address: { street: "Rua Teste", neighborhood: "Centro", city: "Palmas", state: "TO", zipCode: "77000000" }, guest: { email: "cliente@example.com" } };
const request = (payment: unknown) => new NextRequest("https://example.com/api/pedidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, payment }) });

describe("proteções na API de pedidos", () => {
  it("rejeita cartão bruto antes de consultar ou criar pedido", async () => {
    vi.stubEnv("PAYMENT_DRIVER", "mercadopago");
    const res = await POST(request({ method: "card", card: { number: "4111111111111111", cvv: "123" } }));
    expect(res.status).toBe(400);
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });
  it("bloqueia configuração ausente em produção antes de criar pedido", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENT_DRIVER", undefined);
    const res = await POST(request({ method: "pix" }));
    expect(res.status).toBe(503);
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });
  it("bloqueia cartão sem token antes de criar pedido", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENT_DRIVER", "mercadopago");
    const res = await POST(request({ method: "card" }));
    expect(res.status).toBe(400);
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });
});
