import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, updateMany, buscarPagamento, finalizarPedidoPago, enfileirarEvento, entregarEvento, prismaMock } =
  vi.hoisted(() => {
    const prismaMock = {
      order: { findMany: vi.fn(), updateMany: vi.fn() },
      $transaction: vi.fn(),
    };
    return {
      findMany: prismaMock.order.findMany,
      updateMany: prismaMock.order.updateMany,
      buscarPagamento: vi.fn(),
      finalizarPedidoPago: vi.fn(),
      enfileirarEvento: vi.fn(),
      entregarEvento: vi.fn(),
      prismaMock,
    };
  });

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/mercadopago", () => ({ buscarPagamento }));
vi.mock("@/lib/pedidos/finalizar", () => ({ finalizarPedidoPago }));
vi.mock("@/lib/erp", () => ({ enfileirarEvento, entregarEvento }));

import {
  HORAS_PARA_CANCELAR_PIX,
  decidirReconciliacao,
  reconciliarPixPendentes,
} from "@/lib/reconciliar-pix";

const AGORA = new Date("2026-10-17T15:00:00Z");
const pedido = (horas: number) => ({
  id: "ord-1",
  number: "DC-20261017-0001",
  paymentId: "184666023462",
  createdAt: new Date(AGORA.getTime() - horas * 3_600_000),
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock)
  );
  enfileirarEvento.mockResolvedValue("evt-1");
  entregarEvento.mockResolvedValue(false);
});

describe("decidirReconciliacao", () => {
  it("aprovado no MP → finalizar (mesmo sem webhook)", () => {
    expect(decidirReconciliacao("approved", 1)).toBe("finalizar");
    expect(decidirReconciliacao("approved", 100)).toBe("finalizar");
  });

  it("expired/rejected/cancelled/refused → cancelar", () => {
    for (const s of ["expired", "rejected", "cancelled", "refused"]) {
      expect(decidirReconciliacao(s, 1)).toBe("cancelar");
    }
  });

  it("pending recente → manter (webhook ainda pode chegar)", () => {
    expect(decidirReconciliacao("pending", 1)).toBe("manter");
    expect(decidirReconciliacao("in_process", 12)).toBe("manter");
  });

  it(`pending com >= ${HORAS_PARA_CANCELAR_PIX}h → cancelar (Pix já expirou)`, () => {
    expect(decidirReconciliacao("pending", HORAS_PARA_CANCELAR_PIX)).toBe("cancelar");
    expect(decidirReconciliacao("pending", 100)).toBe("cancelar");
    expect(decidirReconciliacao("pending", HORAS_PARA_CANCELAR_PIX - 1)).toBe("manter");
  });

  it("status inesperado → manter (não mexe, inspeção manual)", () => {
    expect(decidirReconciliacao("charged_back", 100)).toBe("manter");
  });
});

describe("reconciliarPixPendentes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([]);
    updateMany.mockResolvedValue({ count: 1 });
  });

  it("sem MP_ACCESS_TOKEN → ignora sem tocar no banco", async () => {
    const r = await reconciliarPixPendentes({ token: null, agora: AGORA });
    expect(r.ignorado).toMatch(/MP_ACCESS_TOKEN/);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("pagamento aprovado → finaliza o pedido (sem webhook)", async () => {
    findMany.mockResolvedValue([pedido(3)]);
    buscarPagamento.mockResolvedValue({ id: "184666023462", status: "approved", referenciaExterna: "ord-1" });
    finalizarPedidoPago.mockResolvedValue({ ok: true, jaFinalizado: false });

    const r = await reconciliarPixPendentes({ token: "tok", agora: AGORA });
    expect(finalizarPedidoPago).toHaveBeenCalledWith("ord-1", "184666023462");
    expect(r).toMatchObject({ processados: 1, finalizados: 1, erros: 0 });
  });

  it("pix expirado → cancela o pedido (só se ainda PENDING) e avisa ERP", async () => {
    findMany.mockResolvedValue([pedido(2)]);
    buscarPagamento.mockResolvedValue({ id: "p1", status: "expired", referenciaExterna: "ord-1" });

    const r = await reconciliarPixPendentes({ token: "tok", agora: AGORA });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "ord-1", paymentStatus: "PENDING" },
      data: { status: "CANCELLED", paymentStatus: "FAILED" },
    });
    expect(enfileirarEvento).toHaveBeenCalledWith(
      "pedido_cancelado",
      {
        numero: "DC-20261017-0001",
        motivo: "Pix não confirmado (expired)",
      },
      expect.objectContaining({
        businessKey: "pedido_cancelado:ord-1",
        db: prismaMock,
      })
    );
    expect(entregarEvento).toHaveBeenCalledWith("evt-1");
    expect(r).toMatchObject({ cancelados: 1 });
  });

  it("pedido já finalizado em corrida (updateMany count=0) → não conta nem avisa", async () => {
    findMany.mockResolvedValue([pedido(2)]);
    buscarPagamento.mockResolvedValue({ id: "p1", status: "expired", referenciaExterna: "ord-1" });
    updateMany.mockResolvedValue({ count: 0 });

    const r = await reconciliarPixPendentes({ token: "tok", agora: AGORA });
    expect(enfileirarEvento).not.toHaveBeenCalled();
    expect(entregarEvento).not.toHaveBeenCalled();
    expect(r).toMatchObject({ cancelados: 0, mantidos: 1 });
  });

  it("pendente recente → mantém (dá tempo do webhook)", async () => {
    findMany.mockResolvedValue([pedido(1)]);
    buscarPagamento.mockResolvedValue({ id: "p1", status: "pending", referenciaExterna: "ord-1" });

    const r = await reconciliarPixPendentes({ token: "tok", agora: AGORA });
    expect(finalizarPedidoPago).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(r).toMatchObject({ mantidos: 1 });
  });

  it("erro do MP num pedido não derruba os demais", async () => {
    findMany.mockResolvedValue([pedido(3), { ...pedido(4), id: "ord-2" }]);
    buscarPagamento
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ id: "p2", status: "approved", referenciaExterna: "ord-2" });
    finalizarPedidoPago.mockResolvedValue({ ok: true, jaFinalizado: false });

    const r = await reconciliarPixPendentes({ token: "tok", agora: AGORA });
    expect(r).toMatchObject({ processados: 2, finalizados: 1, erros: 1 });
  });
});
