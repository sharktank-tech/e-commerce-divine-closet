import { prisma } from "@/lib/prisma";
import {
  buildGa4RefundEvent,
  refundDedupeKey,
} from "@/lib/ga4-refund";

/**
 * Prepara uma intenção de refund sem enviar eventos, com guardas fail-closed.
 * Esta função NÃO altera estados financeiros e NÃO integra o fluxo de estorno
 * até a captura/revogação consentidas serem implementadas e testadas.
 */
export async function enqueueGa4RefundIfAuthorized(orderId: string): Promise<
  "CREATED" | "ALREADY_EXISTS" | "SKIPPED"
> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, refund: true, analyticsIdentity: true },
  });
  if (!order || order.paymentStatus !== "REFUNDED" || order.refund?.status !== "APPROVED")
    return "SKIPPED";

  const identity = order.analyticsIdentity;
  if (
    !identity ||
    identity.consentState !== "GRANTED" ||
    !identity.consentProofAt ||
    identity.revokedAt ||
    !identity.clientId ||
    !/^\d+\.\d+$/.test(identity.clientId)
  ) return "SKIPPED";

  // A política atual não autoriza envio até que exista sincronização
  // comprovada de revogação e verificação imediatamente antes da entrega.
  // Mesmo PENDING significa somente intenção, não consentimento permanente.
  const event = buildGa4RefundEvent({
    orderId: order.id,
    approved: true,
    subtotal: Number(order.subtotal),
    discount: Number(order.discount),
    shipping: Number(order.shipping),
    total: Number(order.total),
    items: order.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
    })),
  });

  try {
    await prisma.analyticsEvent.create({
      data: {
        orderId: order.id,
        dedupeKey: refundDedupeKey(order.refund.id),
        eventType: event.name,
        // Nunca persistir nome, email ou dados do pagador na outbox.
        // client_id só será lido do registro autorizado no instante de entrega.
        payload: event.params,
        status: "PENDING",
      },
    });
    return "CREATED";
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") return "ALREADY_EXISTS";
    throw error;
  }
}
