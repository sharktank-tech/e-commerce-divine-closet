import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buscarPagamento,
  criarPagamentoCartao,
  criarPagamentoPix,
  extrairAssinatura,
  mapearStatusMp,
  montarCartao,
  montarPix,
  traduzirErroMp,
  verificarAssinaturaWebhook,
} from "@/lib/mercadopago";

let ultimaChamada: { url: string; init?: RequestInit } | null = null;

function mockFetch(resposta: unknown, ok = true) {
  ultimaChamada = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      ultimaChamada = { url, init };
      return { ok, json: async () => resposta };
    })
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

  it("sem url de notificação: omite notification_url (MP rejeita string vazia)", () => {
    expect(
      montarPix({ valor: 1, email: "c@c.com", referenciaExterna: "p", descricao: "d" })
    ).not.toHaveProperty("notification_url");
    expect(
      montarPix({ valor: 1, email: "c@c.com", referenciaExterna: "p", descricao: "d", urlNotificacao: "" })
    ).not.toHaveProperty("notification_url");
    expect(
      montarCartao({ token: "t", valor: 1, parcelas: 1, bandeira: "visa", email: "c@c.com", referenciaExterna: "p", descricao: "d", urlNotificacao: "" })
    ).not.toHaveProperty("notification_url");
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

  it("POST envia X-Idempotency-Key (MP exige em criar pagamento)", async () => {
    mockFetch({ id: 1, status: "pending" });
    await criarPagamentoPix("tok", {
      valor: 5, email: "c@c.com", referenciaExterna: "p",
      descricao: "d", urlNotificacao: "u",
    });
    const h = (ultimaChamada?.init?.headers || {}) as Record<string, string>;
    expect(h["X-Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("GET não envia o header", async () => {
    mockFetch({ id: 7, status: "approved" });
    await buscarPagamento("tok", "7");
    const h = (ultimaChamada?.init?.headers || {}) as Record<string, string>;
    expect(h["X-Idempotency-Key"]).toBeUndefined();
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
    expect(r).toEqual(
      expect.objectContaining({
        id: "7",
        status: "approved",
        referenciaExterna: "ped-9",
      })
    );
  });
});

describe("traduzirErroMp", () => {
  it("live credentials com dados de teste → orientação teste x produção", () => {
    const msg = traduzirErroMp("Mercado Pago: Unauthorized use of live credentials");
    expect(msg).toMatch(/TEST-/);
    expect(msg).not.toMatch(/Unauthorized/);
  });

  it("token inválido → orientação de redeploy", () => {
    expect(traduzirErroMp("Mercado Pago: invalid_token")).toMatch(/redeploy/);
  });

  it("desconhecido → mensagem original", () => {
    expect(traduzirErroMp("Mercado Pago: xyz-123")).toBe("Mercado Pago: xyz-123");
  });
});

describe("assinatura do webhook", () => {
  it("extrai ts/v1; inválido → null", () => {
    expect(extrairAssinatura("ts=123,v1=abc")).toEqual({ ts: "123", v1: "abc" });
    expect(extrairAssinatura(null)).toBeNull();
    expect(extrairAssinatura("ts=123")).toBeNull();
  });

  it("manifesto OFICIAL do MP: id:...;request-id:...;ts:...; — HMAC válido passa", async () => {
    const { createHmac } = await import("crypto");
    const manifest = "id:99;request-id:req-1;ts:1700000000;";
    const v1 = createHmac("sha256", "segredo").update(manifest).digest("hex");
    expect(verificarAssinaturaWebhook("99", "req-1", "1700000000", v1, "segredo")).toBe(true);
    expect(verificarAssinaturaWebhook("99", "req-1", "1700000000", "00", "segredo")).toBe(false);
    expect(verificarAssinaturaWebhook("99", "req-1", "1700000000", v1, null)).toBe(false);
  });

  it("data.id alfanumérico entra em minúsculas; request-id sem prefixo errado", async () => {
    const { createHmac } = await import("crypto");
    const manifest = "id:b33fnb4gc4d3w5w75;request-id:ReQ-9;ts:1700000000;";
    const v1 = createHmac("sha256", "segredo").update(manifest).digest("hex");
    expect(verificarAssinaturaWebhook("B33FNB4GC4D3W5W75", "ReQ-9", "1700000000", v1, "segredo")).toBe(true);
    // formato antigo (sem prefixos) NÃO é aceito
    const antigo = createHmac("sha256", "segredo").update("b33fnb4gc4d3w5w75;ReQ-9;1700000000").digest("hex");
    expect(verificarAssinaturaWebhook("B33FNB4GC4D3W5W75", "ReQ-9", "1700000000", antigo, "segredo")).toBe(false);
  });

  it("x-request-id ausente → par omitido do manifesto (comportamento dos SDKs oficiais)", async () => {
    const { createHmac } = await import("crypto");
    const manifest = "id:99;ts:1700000000;";
    const v1 = createHmac("sha256", "segredo").update(manifest).digest("hex");
    expect(verificarAssinaturaWebhook("99", "", "1700000000", v1, "segredo")).toBe(true);
  });
});

import { buscarPagamentoPorReferencia, PagamentosAmbiguosError, validarIdentidadePagamento } from "@/lib/mercadopago";

describe("identidade financeira e busca de tentativas", () => {
  const pedido = { id: "ord", paymentId: "1", total: 32.99 };
  const raw = (id: number, status = "approved") => ({ id, status, external_reference: "ord", currency_id: "BRL", transaction_amount: 32.99 });
  const pagamento = { id: "1", status: "approved", referenciaExterna: "ord", currencyId: "BRL", transactionAmount: 32.99 };
  it("adaptador expõe moeda e valor consultados", async () => {
    mockFetch(raw(1));
    expect(await buscarPagamento("tok", "1")).toEqual(pagamento);
  });
  it("webhook antes de persistir paymentId aceita apenas referência, moeda e valor exatos", () => {
    expect(validarIdentidadePagamento(pagamento, { ...pedido, paymentId: null }).ok).toBe(true);
    for (const p of [{ ...pagamento, referenciaExterna: "outra" }, { ...pagamento, currencyId: null }, { ...pagamento, transactionAmount: null }]) {
      expect(validarIdentidadePagamento(p, { ...pedido, paymentId: null }).ok).toBe(false);
    }
  });
  it.each([undefined, null, NaN, Infinity, 32.98, 33])("valor inválido %s nunca confirma", valor => {
    expect(validarIdentidadePagamento({ ...pagamento, transactionAmount: valor }, pedido).ok).toBe(false);
  });
  it("reconciliação exige referência exata mesmo com paymentId diferente ou igual", () => {
    for (const paymentId of ["1", "outro", null]) {
      expect(validarIdentidadePagamento({ ...pagamento, referenciaExterna: "outra" }, { ...pedido, paymentId }, "reconciliacao").ok).toBe(false);
    }
  });
  it.each([{}, { status: "approved" }, { id: 1 }, { id: null, status: "approved" }])("resposta incompleta não vira id undefined: %j", async resposta => {
    mockFetch(resposta);
    await expect(criarPagamentoPix("tok", { valor: 32.99, email: "a@example.com", referenciaExterna: "ord", descricao: "d" }, "estavel")).rejects.toThrow(/incompleta/);
  });
  it("aprovação prevalece sobre recusa mais recente, sem depender da ordem", async () => {
    for (const results of [[raw(2, "rejected"), raw(1)], [raw(1), raw(2, "rejected")]]) {
      mockFetch({ results });
      expect((await buscarPagamentoPorReferencia("tok", "ord"))?.id).toBe("1");
    }
  });
  it("duas aprovações distintas exigem revisão, nunca escolhe só a primeira", async () => {
    mockFetch({ results: [raw(1), raw(2)] });
    await expect(buscarPagamentoPorReferencia("tok", "ord")).rejects.toBeInstanceOf(PagamentosAmbiguosError);
  });
  it("busca vazia é distinta de resposta inválida/erro", async () => {
    mockFetch({ results: [] });
    expect(await buscarPagamentoPorReferencia("tok", "ord")).toBeNull();
    mockFetch({});
    await expect(buscarPagamentoPorReferencia("tok", "ord")).rejects.toThrow(/incompleta/);
    mockFetch({ message: "erro" }, false);
    await expect(buscarPagamentoPorReferencia("tok", "ord")).rejects.toThrow();
  });
});
