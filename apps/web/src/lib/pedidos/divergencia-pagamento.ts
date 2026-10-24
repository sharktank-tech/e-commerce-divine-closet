import { prisma } from "@/lib/prisma";

/** Dados sanitizados e persistidos; nenhum estorno automático. */
export async function registrarDivergenciaPagamento(orderId: string, motivo: string, paymentIds: string[], aprovadoVerificado = false) {
  await prisma.order.updateMany({
    where: { id: orderId, deletedAt: null },
    data: {
      ...(aprovadoVerificado ? { paymentStatus: "PAID" as const } : {}),
      holdCode: "REVISAO_FINANCEIRA",
      holdReason: `${motivo}: ${paymentIds.join(",")}`.slice(0, 500),
      holdAt: new Date(),
    },
  });
}
