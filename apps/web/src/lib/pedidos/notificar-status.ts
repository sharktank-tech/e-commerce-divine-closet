import { prisma } from "@/lib/prisma";
import { emails } from "@/lib/email";
import {
  criarTokenAcompanhamento,
  linkAcompanhamento,
} from "@/lib/pedidos/acompanhar";
import { linkRastreio, rotuloTransportadora } from "@/lib/rastreio";

// E-mail transacional por STATUS REAL do pedido (pago, preparo, enviado,
// entregue, cancelado, estornado) com botão de acompanhamento.
// Anti-duplicado: quem chama decide notificar apenas quando algo mudou
// (status novo OU rastreio divulgado pela 1ª vez).

type Db = Pick<typeof prisma, "order" | "orderTrackToken">;

type OrderParaLink = {
  id: string;
  userId: string | null;
  guestEmail: string | null;
};

/**
 * Link de acompanhamento do pedido.
 * - Logado → /conta (abas de pedidos) — não depende de token.
 * - Convidado → link privado /acompanhar/[token]; cria só se não há token
 *   ativo (sem plaintext guardado, um token ativo não pode ser "reenviado" —
 *   nesse caso o cliente usa o link do e-mail de confirmação ou pede um
 *   novo na página /acompanhar).
 */
export async function montarLinkAcompanhamento(
  order: OrderParaLink,
  db?: Partial<Pick<typeof prisma, "orderTrackToken">>
): Promise<{ link: string | null; nota: string | null }> {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || "https://www.divinecloset.com.br"
  ).replace(/\/$/, "");

  if (order.userId) {
    return { link: `${base}/conta?tab=pedidos`, nota: null };
  }
  if (!order.guestEmail) return { link: null, nota: null };

  if (!db?.orderTrackToken) return { link: null, nota: null };
  try {
    const token = await criarTokenAcompanhamento(
      { orderId: order.id, sentTo: order.guestEmail },
      db as Parameters<typeof criarTokenAcompanhamento>[1]
    );
    if (token) return { link: linkAcompanhamento(token), nota: null };
    return {
      link: null,
      nota: "Use o link do seu e-mail de confirmação ou peça um novo em " +
        `${base}/acompanhar`,
    };
  } catch (err) {
    console.error("[status-email:token]", err);
    return { link: null, nota: null };
  }
}

/** Guarda de anti-duplicado: notifica só com mudança real. */
export function deveNotificarStatus(
  anterior: { status: string; trackingCode: string | null } | null,
  atual: { status: string; trackingCode: string | null }
): boolean {
  if (!anterior) return false;
  if (anterior.status !== atual.status) return true;
  // rastreio divulgado pela primeira vez
  if (!anterior.trackingCode && atual.trackingCode) return true;
  return false;
}

/**
 * Renderiza o e-mail do status (sem enviar). É o payload que o outbox grava
 * UMA vez — imutável entre tentativas, exigência da chave Idempotency-Key
 * do Resend. Retorno null = sem pedido ou sem destinatário (nada a notificar).
 */
export async function montarEmailStatusPedido(
  input: { orderId: string; status: string },
  deps: {
    db?: Db;
  } = {}
): Promise<{ to: string; subject: string; text: string; html: string | null } | null> {
  const db = deps.db ?? (prisma as unknown as Db);

  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      number: true,
      status: true,
      userId: true,
      guestEmail: true,
      trackingCode: true,
      trackingCarrier: true,
      trackingUrl: true,
      user: { select: { email: true } },
    },
  });
  if (!order) return null;

  const para = order.user?.email || order.guestEmail;
  if (!para) return null;

  const { link, nota } = await montarLinkAcompanhamento(
    { id: order.id, userId: order.userId, guestEmail: order.guestEmail },
    db
  );

  const mail = emails.statusPedido(order.number, input.status, {
    link,
    linkNota: nota,
    tracking: order.trackingCode
      ? {
          codigo: order.trackingCode,
          transportadora: rotuloTransportadora(order.trackingCarrier),
          url: linkRastreio(order),
        }
      : null,
  });

  return { to: para, subject: mail.subject, text: mail.text, html: mail.html ?? null };
}
