import { prisma } from "@/lib/prisma";

/**
 * Camada interna: deve ser chamada somente após autenticação/prova de posse
 * do pedido pelo endpoint que será desenvolvido na próxima fase.
 * Não é uma API pública. Marca identidade revogada e cancela intenções
 * ainda não aceitas, numa única transação.
 *
 * Esta transação bloqueia as linhas da outbox durante a revogação e isola
 * tentativas PROCESSING incertas. Transporte externo continua hard-off;
 * uma futura entrega exigirá serialização de egress sob política própria.
 */
export async function revokeOrderAnalyticsConsent(
  orderId: string,
  requesterId?: string | null,
): Promise<{ revoked: boolean; skipped: number; inFlightQuarantined: number }> {
  // Verificação de posse: se requesterId for fornecido, verificar que o pedido
  // pertence ao solicitante. Sem requesterId (chamada interna), a verificação
  // deve ser feita pelo chamador.
  if (requesterId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, guestEmail: true },
    });
    if (!order) throw new Error("order_not_found");
    if (order.userId !== requesterId) {
      throw new Error("unauthorized: requester does not own this order");
    }
  }

  return prisma.$transaction(async (tx) => {
    // Lock das linhas elegíveis antes de ler/escrever estados; o worker só
    // pode finalizar por CAS status=PROCESSING, sem reabrir uma revogação.
    await tx.$queryRaw`
      SELECT "id" FROM "AnalyticsEvent"
      WHERE "orderId" = ${orderId}::uuid
        AND "status" IN ('PENDING', 'FAILED', 'PROCESSING')
      ORDER BY "id" FOR UPDATE
    `;
    const changed = await tx.analyticsOrderIdentity.updateMany({
      where: { orderId, consentState: { not: "REVOKED" } },
      data: {
        consentState: "REVOKED",
        clientId: null,
        revokedAt: new Date(),
      },
    });
    const pending = await tx.analyticsEvent.updateMany({
      where: { orderId, status: { in: ["PENDING", "FAILED"] } },
      data: {
        status: "SKIPPED",
        leaseUntil: null,
        lastError: "consent_revoked",
      },
    });
    const inFlight = await tx.analyticsEvent.updateMany({
      where: { orderId, status: "PROCESSING" },
      data: { status: "FAILED", leaseUntil: null, lastError: "consent_revoked_inflight_uncertain" },
    });
    return { revoked: changed.count > 0, skipped: pending.count, inFlightQuarantined: inFlight.count };
  });
}
