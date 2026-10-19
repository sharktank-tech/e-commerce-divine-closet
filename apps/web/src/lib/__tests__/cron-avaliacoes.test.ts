import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Cron de convite de avaliação: enfileira no OUTBOX (dedupeKey review:{id})
// ANTES de enviar — o marcador deixa de ser a única defesa. Reprova o novo
// fluxo: enqueue idempotente → tentativa imediata → marcador; e que uma
// reexecução (marcador ainda nulo porque o envio falhou) re-enfileira na
// MESMA linha (dedupe) em vez de gerar um 2º convite.
const { prismaMock, enfileirarMock, processarMock, autorizarMock, reviewRequestMock } =
  vi.hoisted(() => ({
    prismaMock: { order: { findMany: vi.fn(), update: vi.fn() } },
    enfileirarMock: vi.fn(),
    processarMock: vi.fn(),
    autorizarMock: vi.fn(),
    reviewRequestMock: vi.fn(),
  }));

vi.mock("@/lib/cron-auth", () => ({ autorizarCron: autorizarMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/email", () => ({
  emails: { reviewRequest: reviewRequestMock },
}));
vi.mock("@/lib/email-outbox", () => ({
  enfileirarEmail: enfileirarMock,
  processarEmailOutbox: processarMock,
}));

import { GET } from "@/app/api/cron/avaliacoes/route";

function pedido(id: string, n = 1) {
  return {
    id,
    number: `DC-${n}`,
    user: { email: "c@x.com", name: "C" },
    items: [{ productId: "p1", productName: "Vestido", productSlug: "vestido" }],
  };
}

function req(): NextRequest {
  return {
    headers: { get: () => "Bearer t" },
    nextUrl: { origin: "https://loja.test" },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  autorizarMock.mockReturnValue(true);
  reviewRequestMock.mockReturnValue({ subject: "Avalie", text: "texto", html: "<p>t</p>" });
  prismaMock.order.update.mockResolvedValue({});
  enfileirarMock.mockResolvedValue("ob-1");
  processarMock.mockResolvedValue("ENVIADO");
});

describe("GET /api/cron/avaliacoes — convite via outbox", () => {
  it("enfileira (dedupeKey review:{id}) → tenta envio → grava marcador", async () => {
    prismaMock.order.findMany.mockResolvedValue([pedido("o1", 1)]);
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.enviados).toBe(1);
    expect(enfileirarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: "review:o1",
        kind: "review_invite",
        orderId: "o1",
        mail: expect.objectContaining({ to: "c@x.com", subject: "Avalie" }),
      })
    );
    expect(processarMock).toHaveBeenCalledWith("ob-1");
    expect(prismaMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "o1" } })
    );
  });

  it("reexecução re-enfileira na MESMA ocorrência (dedupe) — sem duplicar convite", async () => {
    prismaMock.order.findMany.mockResolvedValue([pedido("o1", 1)]);
    // 1ª execução
    await GET(req());
    // 2ª execução no mesmo ciclo/period: a dedupeKey é a mesma → dedupe interno
    // (enfileirarEmail devolve a linha existente) — a rota segue idempotente.
    await GET(req());
    const chaves = enfileirarMock.mock.calls.map((c) => c[0].dedupeKey);
    expect(chaves).toEqual(["review:o1", "review:o1"]); // mesma chave nos dois
    // o envio só acontece sobre a MESMA linha devolvida pelo enqueue
    expect(processarMock).toHaveBeenCalledWith("ob-1");
  });

  it("sem destinatário → pulado antes do enqueue, sem marcador nem envio", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      { ...pedido("o2", 2), user: { email: null, name: null } },
    ]);
    const res = await GET(req());
    const body = await res.json();
    expect(body.pulados).toBe(1);
    expect(enfileirarMock).not.toHaveBeenCalled();
    expect(processarMock).not.toHaveBeenCalled();
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it("enqueue devolve null (nada a notificar) → pulado, sem marcador nem envio", async () => {
    prismaMock.order.findMany.mockResolvedValue([pedido("o3", 3)]);
    enfileirarMock.mockResolvedValue(null);
    const res = await GET(req());
    const body = await res.json();
    expect(body.pulados).toBe(1);
    expect(processarMock).not.toHaveBeenCalled();
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it("não autorizado → 401", async () => {
    autorizarMock.mockReturnValue(false);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });
});
