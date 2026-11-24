import { prisma } from "@/lib/prisma";
import { enqueueGa4RefundIfAuthorized } from "@/lib/ga4-refund-outbox";

/**
 * Reconcilia intenções analíticas de pedidos com refund confirmado.
 *
 * Não envia eventos ao GA4 e não altera estado financeiro.
 * O chamador controla a paginação por ID e deve continuar com nextCursor
 * até receber null. Sem isso, um lote fixo pode deixar pedidos posteriores
 * sem análise. Recomeçar sem cursor permite nova rodada periódica completa.
 *
 * Mesmo pedidos sem consentimento são contabilizados como SKIPPED; isso
 * evita ocultar lacunas ao varrer a população de pedidos.
 * A unicidade dedupeKey garante idempotência do enqueue.
 */
export async function reconcileGa4RefundIntents(
  limit: number = 10,
  afterOrderId?: string,
): Promise<{
  checked: number;
  created: number;
  alreadyExists: number;
  skipped: number;
  errors: number;
  nextCursor: string | null;
}> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("invalid_reconciliation_limit");
  if (afterOrderId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(afterOrderId))
    throw new Error("invalid_reconciliation_cursor");

  const result = {
    checked: 0,
    created: 0,
    alreadyExists: 0,
    skipped: 0,
    errors: 0,
    nextCursor: null as string | null,
  };

  // Keyset pagination: id > cursor não depende da existência posterior
  // da linha do cursor. limit + 1 sinaliza se há outra página.
  const refundedOrders = await prisma.order.findMany({
    where: {
      paymentStatus: "REFUNDED",
      refund: { status: "APPROVED" },
      ...(afterOrderId ? { id: { gt: afterOrderId } } : {}),
    },
    orderBy: { id: "asc" },
    select: { id: true },
    take: limit + 1,
  });
  const page = refundedOrders.slice(0, limit);
  if (refundedOrders.length > limit)
    result.nextCursor = page[page.length - 1].id;

  for (const order of page) {
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
