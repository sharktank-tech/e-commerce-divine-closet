import { prisma } from "@/lib/prisma";
import { buscarPagamento } from "@/lib/mercadopago";
import { finalizarPedidoPago } from "@/lib/pedidos/finalizar";
import {
  enfileirarEmailStatusPedido,
  processarEmailOutbox,
} from "@/lib/email-outbox";
import { entregarEvento, enfileirarEvento } from "@/lib/erp";

// Reconciliação de pagamento pendente — rede de segurança do webhook do MP.
// Roda 1x/dia no cron de carrinho-abandonado (plano Hobby: no máximo 2
// crons diários; a rota /api/cron/reconciliar-pix permite gatilho manual
// com CRON_SECRET). Cobre: notificação perdida (pagou e ficou órfão) e
// pagamento expirado/recusado (pedido PENDING para sempre).
//
// AMPLIAÇÃO (diagnóstico PR #15, defeito #1): antes só `paymentMethod: PIX`
// entrava na varredura. Com o cartão `in_process` agora PRESERVADO como
// PENDING (antes virava recusa e o pedido era cancelado), um cartão em
// análise antifraude cuja notificação se perdesse ficaria pendurado para
// sempre. A varredura passa a cobrir PIX, CARD e BOLETO, cada um com a sua
// janela de expiração.

export const HORAS_PARA_CANCELAR_PIX = 48;

/** Janela de expiração por método de pagamento (horas desde a criação). */
export const HORAS_PARA_CANCELAR: Record<string, number> = {
  PIX: 48, // QR do Pix expira em ~30 min; 48h dá folga p/ notificação perdida
  CARD: 168, // 7 dias — análise antifraude do cartão pode levar dias
  BOLETO: 120, // 5 dias úteis de vencimento do boleto
};

/** Fallback para método desconhecido (mantém o valor histórico do Pix). */
export const JANELA_PADRAO_HORAS = HORAS_PARA_CANCELAR_PIX;

export type DecisaoReconciliacao = "finalizar" | "cancelar" | "manter";

/**
 * Decide o que fazer com um pedido ainda PENDING, dado o status bruto do
 * pagamento no Mercado Pago, a idade do pedido e o método de pagamento.
 */
export function decidirReconciliacao(
  statusMp: string,
  horasDesdeCriacao: number,
  metodoPagamento: string = "PIX"
): DecisaoReconciliacao {
  if (statusMp === "approved") return "finalizar";
  if (["expired", "rejected", "cancelled", "refused"].includes(statusMp)) {
    return "cancelar";
  }
  if (["pending", "in_process", "in_mediation"].includes(statusMp)) {
    const janela = HORAS_PARA_CANCELAR[metodoPagamento] ?? JANELA_PADRAO_HORAS;
    return horasDesdeCriacao >= janela ? "cancelar" : "manter";
  }
  // Status fora do esperado: não mexe (inspeção manual).
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
  // minutos atrás. Só pedido ainda PENDING (aprovado via webhook nunca entra).
  const carencia = new Date(agora.getTime() - 5 * 60 * 1000);
  const pedidos = await prisma.order.findMany({
    where: {
      status: "PENDING",
      paymentStatus: "PENDING",
      // Todos os métodos: Pix, cartão em análise (in_process) e boleto.
      paymentMethod: { in: ["PIX", "CARD", "BOLETO"] },
      paymentId: { not: null },
      deletedAt: null,
      createdAt: { lte: carencia },
    },
    orderBy: { createdAt: "asc" },
    // Padrão subiu de 30 para 100: 30/dia deixava fila crescendo se a
    // reconciliação falhasse alguns dias seguidos (só 30 pedidos/dia).
    take: opcoes?.limite ?? 100,
    select: { id: true, number: true, paymentId: true, createdAt: true, paymentMethod: true },
  });

  for (const pedido of pedidos) {
    resumo.processados++;
    try {
      const pagamento = await buscarPagamento(token, pedido.paymentId as string);
      const horas =
        (agora.getTime() - pedido.createdAt.getTime()) / 3_600_000;
      const decisao = decidirReconciliacao(pagamento.status, horas, pedido.paymentMethod);

      if (decisao === "finalizar") {
        const r = await finalizarPedidoPago(pedido.id, pagamento.id);
        if (!r.jaFinalizado) resumo.finalizados++;
        else resumo.mantidos++;
      } else if (decisao === "cancelar") {
        // Guarda de corrida + evento + notificação na MESMA transação: só
        // cancela se ainda estiver PENDING; o evento e a linha do outbox
        // (dedupeKey status:orderId:CANCELLED) nascem junto — rollback
        // descarta os três. O envio é pós-commit, com retentativa.
        const { count, eventoId, emailId } = await prisma.$transaction(async (tx) => {
          const { count } = await tx.order.updateMany({
            where: { id: pedido.id, paymentStatus: "PENDING" },
            data: { status: "CANCELLED", paymentStatus: "FAILED" },
          });
          let id: string | null = null;
          let mailId: string | null = null;
          if (count === 1) {
            id = await enfileirarEvento(
              "pedido_cancelado",
              { numero: pedido.number, motivo: `Pix não confirmado (${pagamento.status})` },
              { db: tx, businessKey: `pedido_cancelado:${pedido.id}` }
            );
            mailId = await enfileirarEmailStatusPedido(
              pedido.id,
              "CANCELLED",
              tx as Parameters<typeof enfileirarEmailStatusPedido>[2]
            );
          }
          return { count, eventoId: id, emailId: mailId };
        });
        if (count === 1) {
          resumo.cancelados++;
          if (eventoId) {
            void entregarEvento(eventoId).catch((err) =>
              console.error("[reconciliar-pix:erp]", err)
            );
          }
          if (emailId) {
            void processarEmailOutbox(emailId).catch((err) =>
              console.error("[reconciliar-pix:email]", err)
            );
          }
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
