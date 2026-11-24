import { prisma } from "@/lib/prisma";
import { enqueueGa4RefundIfAuthorized } from "@/lib/ga4-refund-outbox";

/**
 * Reconciliação independente de intenções analíticas ausentes.
 *
 * Busca pedidos REFUNDED com estorno APPROVED que não possuem
 * AnalyticsEvent correspondente, e enfileira a intenção.
 *
 * NÃO depende de uma nova transição PAID→REFUNDED.
 * Idempotente: usa dedupeKey UNIQUE para evitar duplicação.
 * Não altera estado financeiro.
 * Não reenvia eventos já aceitos ou de entrega incerta.
 */
export async function reconcileGa4RefundIntents(limit: number = 10): Promise<{
  checked: number;
  created: number;
  alreadyExists: number;
  skipped: number;
  errors: number;
}> {
  const result = { checked: 0, created: 0, alreadyExists: 0, skipped: 0, errors: 0 };

  // Find refunded orders with approved refunds that don't have an analytics event
  const refundedOrders = await prisma.order.findMany({
    where: {
      paymentStatus: "REFUNDED",
      refund: { status: "APPROVED" },
    },
    select: { id: true },
    take: limit,
  });

  for (const order of refundedOrders) {
    result.checked++;
    try {
      const enqueueResult = await enqueueGa4RefundIfAuthorized(order.id);
      if (enqueueResult === "CREATED") result.created++;
      else if (enqueueResult === "ALREADY_EXISTS") result.alreadyExists++;
      else result.skipped++;
    } catch {
      result.errors++;
    }
  }

  return result;
}
