import { prisma } from "@/lib/prisma";
import { buscarPagamento } from "@/lib/mercadopago";
import { finalizarPedidoPago } from "@/lib/pedidos/finalizar";
import { notificarErp } from "@/lib/erp";
import { enviarEmailStatusPedido } from "@/lib/pedidos/notificar-status";

// Reconciliação de Pix pendente — rede de segurança do webhook do MP.
// Roda 1x/dia no cron de carrinho-abandonado (plano Hobby: no máximo 2
// crons diários; a rota /api/cron/reconciliar-pix permite gatilho manual
// com CRON_SECRET). Cobre: notificação perdida (pagou e ficou órfão) e
// Pix expirado/recusado (pedido PENDING para sempre).

export const HORAS_PARA_CANCELAR_PIX = 48;

export type DecisaoReconciliacao = "finalizar" | "cancelar" | "manter";

/**
 * Decide o que fazer com um pedido PIX ainda PENDING, dado o status bruto
 * do pagamento no Mercado Pago e a idade do pedido.
 */
export function decidirReconciliacao(
  statusMp: string,
  horasDesdeCriacao: number
): DecisaoReconciliacao {
  if (statusMp === "approved") return "finalizar";
  if (["expired", "rejected", "cancelled", "refused"].includes(statusMp)) {
    return "cancelar";
  }
  if (["pending", "in_process", "in_mediation"].includes(statusMp)) {
    return horasDesdeCriacao >= HORAS_PARA_CANCELAR_PIX ? "cancelar" : "manter";
  }
  // Status fora do esperado para um Pix PENDING: não mexe (inspeção manual).
  return "manter";
}

export type ResumoReconciliacao = {
  processados: number;
  finalizados: number;
  cancelados: number;
  mantidos: number;
  erros: number;
  ignorado?: string;
};

export async function reconciliarPixPendentes(opcoes?: {
  limite?: number;
  agora?: Date;
  token?: string | null;
}): Promise<ResumoReconciliacao> {
  const resumo: ResumoReconciliacao = {
    processados: 0,
    finalizados: 0,
    cancelados: 0,
    mantidos: 0,
    erros: 0,
  };
  const agora = opcoes?.agora ?? new Date();
  const token = opcoes?.token ?? process.env.MP_ACCESS_TOKEN ?? null;
  if (!token) {
    resumo.ignorado = "MP_ACCESS_TOKEN ausente";
    return resumo;
  }

  // Janela de carência: o webhook tem prioridade; não mexe em pedido de
  // minutos atrás. Só Pix ainda PENDING (aprovado via webhook nunca entra).
  const carencia = new Date(agora.getTime() - 5 * 60 * 1000);
  const pedidos = await prisma.order.findMany({
    where: {
      status: "PENDING",
      paymentStatus: "PENDING",
      paymentMethod: "PIX",
      paymentId: { not: null },
      deletedAt: null,
      createdAt: { lte: carencia },
    },
    orderBy: { createdAt: "asc" },
    take: opcoes?.limite ?? 30,
    select: { id: true, number: true, paymentId: true, createdAt: true },
  });

  for (const pedido of pedidos) {
    resumo.processados++;
    try {
      const pagamento = await buscarPagamento(token, pedido.paymentId as string);
      const horas =
        (agora.getTime() - pedido.createdAt.getTime()) / 3_600_000;
      const decisao = decidirReconciliacao(pagamento.status, horas);

      if (decisao === "finalizar") {
        const r = await finalizarPedidoPago(pedido.id, pagamento.id);
        if (!r.jaFinalizado) resumo.finalizados++;
        else resumo.mantidos++;
      } else if (decisao === "cancelar") {
        // Guarda de corrida: só cancela se ainda estiver PENDING.
        const { count } = await prisma.order.updateMany({
          where: { id: pedido.id, paymentStatus: "PENDING" },
          data: { status: "CANCELLED", paymentStatus: "FAILED" },
        });
        if (count === 1) {
          resumo.cancelados++;
          void notificarErp("pedido_cancelado", {
            numero: pedido.number,
            motivo: `Pix não confirmado (${pagamento.status})`,
          });
          void enviarEmailStatusPedido({
            orderId: pedido.id,
            status: "CANCELLED",
          }).catch((err) => console.error("[reconciliar-pix:email]", err));
        } else {
          resumo.mantidos++;
        }
      } else {
        resumo.mantidos++;
      }
    } catch (err) {
      // Um pedido com problema não derruba a leitura dos demais.
      console.error("[reconciliar-pix]", pedido.id, err);
      resumo.erros++;
    }
  }
  return resumo;
}
