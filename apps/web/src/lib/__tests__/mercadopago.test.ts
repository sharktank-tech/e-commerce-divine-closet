import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buscarPagamento,
  criarPagamentoCartao,
  criarPagamentoPix,
  extrairAssinatura,
  mapearStatusMp,
  montarCartao,
  montarPix,
  verificarAssinaturaWebhook,
} from "@/lib/mercadopago";

function mockFetch(resposta: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => resposta }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mapearStatusMp", () => {
  it("approved → PAID; pending/in_process → PENDING; resto → FAILED", () => {
    expect(mapearStatusMp("approved")).toBe("PAID");
    expect(mapearStatusMp("pending")).toBe("PENDING");
    expect(mapearStatusMp("in_process")).toBe("PENDING");
    expect(mapearStatusMp("rejected")).toBe("FAILED");
    expect(mapearStatusMp("cancelled")).toBe("FAILED");
  });
});

describe("montarPix / montarCartao", () => {
  it("pix: payload mínimo com referência e notificação", () => {
    const p = montarPix({
      valor: 50,
      email: "c@c.com",
      referenciaExterna: "ped-1",
      descricao: "Pedido 1",
      urlNotificacao: "https://loja/api/x",
    });
    expect(p).toMatchObject({
      payment_method_id: "pix",
      external_reference: "ped-1",
    });
  });

  it("cartão: parcelas floor, mínimo 1", () => {
    const p = montarCartao({
      token: "tok", valor: 100, parcelas: 0, bandeira: "visa",
      email: "c@c.com", referenciaExterna: "p", descricao: "d", urlNotificacao: "u",
    });
    expect(p).toMatchObject({ installments: 1, payment_method_id: "visa" });
  });

  it("descrição limitada a 128", () => {
    const p = montarPix({
      valor: 1, email: "c@c.com", referenciaExterna: "p",
      descricao: "x".repeat(200), urlNotificacao: "u",
    });
    expect((p.description as string).length).toBe(128);
  });
});

describe("criarPagamentoPix", () => {
  it("lê QR da resposta", async () => {
    mockFetch({
      id: 123,
      status: "pending",
      point_of_interaction: {
        transaction_data: { qr_code: "COD", qr_code_base64: "B64", ticket_url: "T" },
      },
    });
    const r = await criarPagamentoPix("tok", {
      valor: 50, email: "c@c.com", referenciaExterna: "p",
      descricao: "d", urlNotificacao: "u",
    });
    expect(r).toMatchObject({
      id: "123", status: "pending",
      qr: { codigo: "COD", base64: "B64", ticketUrl: "T" },
    });
  });

  it("erro HTTP vira Error com mensagem", async () => {
    mockFetch({ message: "invalid_token" }, false);
    await expect(
      criarPagamentoPix("ruim", {
        valor: 1, email: "c@c.com", referenciaExterna: "p",
        descricao: "d", urlNotificacao: "u",
      })
    ).rejects.toThrow("Mercado Pago: invalid_token");
  });
});

describe("criarPagamentoCartao / buscarPagamento", () => {
  it("cartão sem QR, com status", async () => {
    mockFetch({ id: 9, status: "approved", status_detail: "accredited" });
    const r = await criarPagamentoCartao("tok", {
      token: "ct", valor: 10, parcelas: 3, bandeira: "master",
      email: "c@c.com", referenciaExterna: "p", descricao: "d", urlNotificacao: "u",
    });
    expect(r.status).toBe("approved");
    expect(r.qr).toBeUndefined();
  });

  it("busca por id com referência externa", async () => {
    mockFetch({ id: 7, status: "approved", external_reference: "ped-9" });
    const r = await buscarPagamento("tok", "7");
    expect(r).toEqual({ id: "7", status: "approved", referenciaExterna: "ped-9" });
  });
});

describe("assinatura do webhook", () => {
  it("extrai ts/v1; inválido → null", () => {
    expect(extrairAssinatura("ts=123,v1=abc")).toEqual({ ts: "123", v1: "abc" });
    expect(extrairAssinatura(null)).toBeNull();
    expect(extrairAssinatura("ts=123")).toBeNull();
  });

  it("HMAC válido passa; errado/ausente falha", async () => {
    const { createHmac } = await import("crypto");
    const base = "99;req-1;1700000000";
    const v1 = createHmac("sha256", "segredo").update(base).digest("hex");
    expect(verificarAssinaturaWebhook("99", "req-1", "1700000000", v1, "segredo")).toBe(true);
    expect(verificarAssinaturaWebhook("99", "req-1", "1700000000", "00", "segredo")).toBe(false);
    expect(verificarAssinaturaWebhook("99", "req-1", "1700000000", v1, null)).toBe(false);
  });
});
