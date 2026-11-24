import { prisma } from "@/lib/prisma";
import {
  buildGa4RefundEvent,
  refundDedupeKey,
} from "@/lib/ga4-refund";

/**
 * Prepara uma intenção de refund sem enviar eventos, com guardas fail-closed.
 * A leitura/decisão e o INSERT ocorrem numa transação protegida por locks
 * de consentimento e identidade, evitando criar PENDING após revogação.
 *
 * A criação de intenções não altera estados financeiros nem ativa o
 * transporte GA4, que permanece hard-off por design.
 */
export async function enqueueGa4RefundIfAuthorized(orderId: string): Promise<
  "CREATED" | "ALREADY_EXISTS" | "SKIPPED"
> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, refund: true, analyticsIdentity: true },
    });
    if (!order || order.paymentStatus !== "REFUNDED" ||
        order.refund?.status !== "APPROVED") return "SKIPPED";

    const initial = order.analyticsIdentity;
    if (!initial?.consentTokenId) return "SKIPPED";

    // Mesma ordem de locks da revogação do endpoint: token, identidade.
    // Se revogação vencer primeiro, a verificação posterior nega o enqueue.
    // Se enqueue vencer, a revogação espera o COMMIT e cancela o novo PENDING.
    await tx.$queryRaw`
      SELECT "id" FROM "AnalyticsBrowserConsent"
      WHERE "id" = ${initial.consentTokenId}::uuid
      FOR UPDATE
    `;
    await tx.$queryRaw`
      SELECT "id" FROM "AnalyticsOrderIdentity"
      WHERE "orderId" = ${orderId}::uuid
      FOR UPDATE
    `;

    const identity = await tx.analyticsOrderIdentity.findUnique({ where: { orderId } });
    if (!identity || identity.consentTokenId !== initial.consentTokenId ||
        identity.consentState !== "GRANTED" || !identity.consentProofAt ||
        identity.revokedAt || !identity.clientId ||
        !/^\d+\.\d+$/.test(identity.clientId)) return "SKIPPED";

    const browserConsent = await tx.analyticsBrowserConsent.findUnique({
      where: { id: identity.consentTokenId! },
    });
    if (!browserConsent || browserConsent.state !== "GRANTED" ||
        browserConsent.revokedAt || browserConsent.expiresAt <= new Date())
      return "SKIPPED";

    // Snapshot financeiro relido dentro da transação após os locks.
    const financial = await tx.order.findUnique({
      where: { id: orderId },
      select: { paymentStatus: true, refund: { select: { status: true, id: true } } },
    });
    if (financial?.paymentStatus !== "REFUNDED" ||
        financial.refund?.status !== "APPROVED" ||
        financial.refund.id !== order.refund.id) return "SKIPPED";

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
      await tx.analyticsEvent.create({
        data: {
          orderId: order.id,
          dedupeKey: refundDedupeKey(order.refund.id),
          eventType: event.name,
          // Nunca incluir client_id, email ou dados do pagador no payload.
          payload: event.params,
          status: "PENDING",
        },
      });
      return "CREATED";
    } catch (error) {
      if ((error as { code?: string })?.code === "P2002") return "ALREADY_EXISTS";
      throw error;
    }
  });
}
