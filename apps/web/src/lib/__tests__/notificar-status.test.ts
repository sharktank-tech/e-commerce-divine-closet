import { beforeEach, describe, expect, it, vi } from "vitest";

// E-mails de status: anti-duplicado (só muda real), link certo por tipo de
// cliente (logado → /conta; convidado → token privado) e template com
// rastreio quando existe.
const { prismaMock, sendEmailMock } = vi.hoisted(() => ({
  prismaMock: {
    order: { findUnique: vi.fn() },
    orderTrackToken: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  sendEmailMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/email", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/email")>();
  return { ...original, sendEmail: sendEmailMock };
});

import { emails } from "@/lib/email";
import { hashToken } from "@/lib/pedidos/acompanhar";
import {
  deveNotificarStatus,
  enviarEmailStatusPedido,
  montarLinkAcompanhamento,
} from "@/lib/pedidos/notificar-status";
import { orderStatusLabel } from "@/lib/utils";

function orderFake(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    number: "DC-1",
    status: "SHIPPED",
    userId: "u1",
    guestEmail: null,
    trackingCode: null,
    trackingCarrier: null,
    trackingUrl: null,
    user: { email: "logada@x.com" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue(undefined);
  prismaMock.orderTrackToken.create.mockResolvedValue({});
  prismaMock.orderTrackToken.update.mockResolvedValue({});
  prismaMock.orderTrackToken.findUnique.mockResolvedValue(null);
});

describe("deveNotificarStatus (anti-duplicado)", () => {
  const atual = { status: "SHIPPED", trackingCode: "BR1" };

  it("sem estado anterior → não notifica", () => {
    expect(deveNotificarStatus(null, atual)).toBe(false);
  });

  it("status diferente → notifica", () => {
    expect(
      deveNotificarStatus({ status: "PAID", trackingCode: null }, atual)
    ).toBe(true);
  });

  it("rastreio divulgado pela 1ª vez → notifica", () => {
    expect(
      deveNotificarStatus({ status: "SHIPPED", trackingCode: null }, atual)
    ).toBe(true);
  });

  it("salvar de novo sem mudança → NÃO notifica (sem duplicar)", () => {
    expect(
      deveNotificarStatus({ status: "SHIPPED", trackingCode: "BR1" }, atual)
    ).toBe(false);
    expect(
      deveNotificarStatus({ status: "SHIPPED", trackingCode: "BR1" }, {
        status: "SHIPPED",
        trackingCode: "BR2",
      })
    ).toBe(false);
  });
});

describe("montarLinkAcompanhamento", () => {
  it("logado → /conta (sem token)", async () => {
    const r = await montarLinkAcompanhamento({
      id: "o1",
      userId: "u1",
      guestEmail: null,
    });
    expect(r.link).toMatch(/\/conta\?tab=pedidos$/);
    expect(prismaMock.orderTrackToken.create).not.toHaveBeenCalled();
  });

  it("convidado sem token → cria link privado /acompanhar/[token]", async () => {
    const r = await montarLinkAcompanhamento(
      { id: "o1", userId: null, guestEmail: "g@g.com" },
      prismaMock as never
    );
    expect(r.link).toMatch(/\/acompanhar\/[A-Za-z0-9_-]{43}$/);
    expect(prismaMock.orderTrackToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: "o1", sentTo: "g@g.com" }),
      })
    );
  });

  it("convidado com token ativo → sem link novo (nota p/ pedir em /acompanhar)", async () => {
    prismaMock.orderTrackToken.findUnique.mockResolvedValue({
      orderId: "o1",
      tokenHash: hashToken("x".repeat(43)),
      sentTo: "g@g.com",
      sendCount: 1,
      lastSentAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
    });
    const r = await montarLinkAcompanhamento(
      { id: "o1", userId: null, guestEmail: "g@g.com" },
      prismaMock as never
    );
    expect(r.link).toBeNull();
    expect(r.nota).toMatch(/\/acompanhar/);
    expect(prismaMock.orderTrackToken.create).not.toHaveBeenCalled();
    expect(prismaMock.orderTrackToken.update).not.toHaveBeenCalled();
  });
});

describe("enviarEmailStatusPedido", () => {
  it("logado: envia com link /conta e assunto do status", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    const ok = await enviarEmailStatusPedido(
      { orderId: "o1", status: "SHIPPED" },
      { db: prismaMock as never, send: sendEmailMock }
    );
    expect(ok).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const mail = sendEmailMock.mock.calls[0][0];
    expect(mail.to).toBe("logada@x.com");
    expect(mail.subject).toBe(
      `Pedido DC-1: ${orderStatusLabel("SHIPPED")}`
    );
    expect(mail.text).toContain("/conta?tab=pedidos");
    expect(mail.text).toContain(orderStatusLabel("SHIPPED"));
  });

  it("convidado: envia com link privado no corpo", async () => {
    prismaMock.order.findUnique.mockResolvedValue(
      orderFake({
        userId: null,
        user: null,
        guestEmail: "g@g.com",
        status: "PAID",
      })
    );
    const ok = await enviarEmailStatusPedido(
      { orderId: "o1", status: "PAID" },
      { db: prismaMock as never, send: sendEmailMock }
    );
    expect(ok).toBe(true);
    const mail = sendEmailMock.mock.calls[0][0];
    expect(mail.to).toBe("g@g.com");
    expect(mail.text).toMatch(/\/acompanhar\/[A-Za-z0-9_-]{43}/);
  });

  it("com rastreio: inclui código e link na mensagem", async () => {
    prismaMock.order.findUnique.mockResolvedValue(
      orderFake({
        trackingCode: "BR123456789",
        trackingCarrier: "correios",
        status: "SHIPPED",
      })
    );
    await enviarEmailStatusPedido(
      { orderId: "o1", status: "SHIPPED" },
      { db: prismaMock as never, send: sendEmailMock }
    );
    const mail = sendEmailMock.mock.calls[0][0];
    expect(mail.text).toContain("BR123456789");
    expect(mail.text).toContain("Correios");
    expect(mail.text).toMatch(/rastreamento\.correios\.com\.br/);
  });

  it("sem destinatário → false e nada enviado", async () => {
    prismaMock.order.findUnique.mockResolvedValue(
      orderFake({ userId: null, user: null, guestEmail: null })
    );
    const ok = await enviarEmailStatusPedido(
      { orderId: "o1", status: "CANCELLED" },
      { db: prismaMock as never, send: sendEmailMock }
    );
    expect(ok).toBe(false);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("falha no envio → false (nunca propaga)", async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderFake());
    sendEmailMock.mockRejectedValue(new Error("smtp down"));
    const ok = await enviarEmailStatusPedido(
      { orderId: "o1", status: "PAID" },
      { db: prismaMock as never, send: sendEmailMock }
    );
    expect(ok).toBe(false);
  });
});

describe("emails.statusPedido (template)", () => {
  it("assunto por status real + frase contextual", () => {
    const enviado = emails.statusPedido("DC-9", "SHIPPED", {});
    expect(enviado.subject).toBe(
      `Pedido DC-9: ${orderStatusLabel("SHIPPED")}`
    );
    expect(enviado.text).toContain("rastreado");

    const estornado = emails.statusPedido("DC-9", "REFUNDED", {});
    expect(estornado.text).toMatch(/estornado/i);
    expect(estornado.html).toContain("estornado");

    const cancelado = emails.statusPedido("DC-9", "CANCELLED", {});
    expect(cancelado.text).toMatch(/cancelado/i);
  });

  it("inclui link (botão) e rastreio quando informados", () => {
    const m = emails.statusPedido("DC-9", "SHIPPED", {
      link: "https://www.divinecloset.com.br/acompanhar/abc",
      tracking: { codigo: "BR1", transportadora: "Correios", url: "https://rastreamento.correios.com.br/" },
    });
    expect(m.html).toContain('href="https://www.divinecloset.com.br/acompanhar/abc"');
    expect(m.html).toContain("BR1");
    expect(m.text).toContain("BR1");
  });

  it("sem link: só instrução (nota) — nunca link inventado", () => {
    const m = emails.statusPedido("DC-9", "DELIVERED", {
      link: null,
      linkNota: "Peça em /acompanhar",
    });
    expect(m.text).toContain("Peça em /acompanhar");
    expect(m.html).not.toContain("Acompanhar pedido</a>");
  });
});
