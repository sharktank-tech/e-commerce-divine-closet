import { prisma } from "@/lib/prisma";

/**
 * Camada interna: deve ser chamada somente após autenticação/prova de posse
 * do pedido pelo endpoint que será desenvolvido na próxima fase.
 * Não é uma API pública. Marca identidade revogada e cancela intenções
 * ainda não aceitas, numa única transação.
 *
 * Limitação: a futura entrega externa exigirá lock/lease compartilhado com
 * esta operação para evitar corridas entre revogação e envio em progresso.
 */
export async function revokeOrderAnalyticsConsent(
  orderId: string,
): Promise<{ revoked: boolean; skipped: number }> {
  return prisma.$transaction(async (tx) => {
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
        lastError: "consent_revoked",
      },
    });
    return { revoked: changed.count > 0, skipped: pending.count };
  });
}
