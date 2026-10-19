import { prisma } from "@/lib/prisma";
import { emails } from "@/lib/email";
import { invalidarCupom } from "@/lib/cupom-cache";
import { type DbErp, entregarEvento, enfileirarEvento } from "@/lib/erp";
import { montarLinkAcompanhamento } from "@/lib/pedidos/notificar-status";
import { dedupeKeyStatusPedido, enfileirarEmail, processarEmailOutbox } from "@/lib/email-outbox";

// Pós-aprovação do pedido — caminho único para confirmação síncrona
// (mock/cartão aprovado na hora) e assíncrona (Pix via webhook do MP).
// Idempotente: só transita PENDING → PAID uma vez; repetição (webhook
// reenviado) não duplica baixa de estoque, cupom nem e-mail.
// Concorrência: trava as linhas dos produtos (FOR UPDATE) e revalida o
// estoque DENTRO da transação — dois checkouts do último item em estoque
// não vendem além do disponível. Eventos ERP (`pedido_pago` com businessKey
// + `estoque_atualizado`) são GRAVADOS na MESMA tx da transição; I/O externo
// (e-mail, entrega do webhook ERP) fica fora da tx, após o commit.

type BancoFinalizar = {
  $transaction(fn: (tx: TxFinalizar) => Promise<unknown>): Promise<unknown>;
  // opcional: fakes de teste podem omitir (link de convidado é best-effort)
  orderTrackToken?: {
    findUnique(args: unknown): Promise<{
      tokenHash: string;
      expiresAt: Date;
      revokedAt: Date | null;
    } | null>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };

  order: {
    findUnique(args: unknown): Promise<{
      id: string;
      number: string;
      paymentStatus: string;
      userId: string | null;
      guestEmail: string | null;
      couponCode: string | null;
      total: unknown;
      paymentMethod: string;
      user: { email: string } | null;
      items: Array<{
        quantity: number;
        size: string | null;
        color: string | null;
        productName: string;
        unitPrice: unknown;
        product: { id: string };
      }>;
    } | null>;
  };
};

type TxFinalizar = {
  $queryRawUnsafe(query: string, ...valores: unknown[]): Promise<unknown>;
  order: {
    update(args: unknown): Promise<unknown>;
  };
  coupon: { update(args: unknown): Promise<unknown> };
  product: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        stock: number;
        variations: Array<{ id: string; size: string; color: string | null; stock: number }>;
      }>
    >;
    update(args: unknown): Promise<unknown>;
  };
  productVariation: {
    update(args: unknown): Promise<unknown>;
  };
  // Opcional: fakes de teste podem omitir — sem modelo não há fila a
  // gravar (transição de negócio segue; evento é melhor-esforço no fake).
  erpEvent?: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<{ id: string } | null>;
  };
};

export async function finalizarPedidoPago(
  orderId: string,
  paymentId?: string,
  db: BancoFinalizar = prisma as unknown as BancoFinalizar
): Promise<{ ok: boolean; jaFinalizado: boolean }> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: { select: { id: true } } } },
      user: { select: { email: true } },
    },
  });
  if (!order) return { ok: false, jaFinalizado: false };
  if (order.paymentStatus !== "PENDING") return { ok: true, jaFinalizado: true };

  const estoquesNovos = new Map<string, number>();
  const eventosErp: string[] = [];

  await db.$transaction(async (tx) => {
    const ids = [...new Set(order.items.map((i) => i.product.id))];
    if (ids.length > 0) {
      await tx.$queryRawUnsafe(
        `SELECT id FROM "Product" WHERE id IN (${ids.map((_, k) => `$${k + 1}::uuid`).join(",")}) FOR UPDATE`,
        ...ids
      );
    }
    const produtos = await tx.product.findMany({
      where: { id: { in: ids } },
      include: { variations: true },
    });
    const porId = new Map(produtos.map((p) => [p.id, p]));
    for (const item of order.items) {
      const prod = porId.get(item.product.id);
      if (!prod || prod.stock < item.quantity) {
        throw new Error("Estoque insuficiente na finalização");
      }
      if (prod.variations.length > 0) {
        const bySize = prod.variations.filter((v) => v.size === item.size);
        const match =
          bySize.find((v) => (v.color ?? null) === (item.color ?? null)) ??
          (!item.color && bySize.length === 1 ? bySize[0] : undefined);
        if (!match || match.stock < item.quantity) {
          throw new Error("Estoque insuficiente na finalização (variação)");
        }
      }
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        paymentStatus: "PAID",
        ...(paymentId ? { paymentId } : {}),
      },
    });

    if (order.couponCode) {
      await tx.coupon.update({
        where: { code: order.couponCode },
        data: { usedCount: { increment: 1 } },
      });
      invalidarCupom(order.couponCode);
    }

    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.product.id },
        data: { stock: { decrement: item.quantity } },
      });
      const prod = porId.get(item.product.id);
      estoquesNovos.set(
        item.product.id,
        Math.max(0, (prod?.stock ?? 0) - item.quantity)
      );
      const bySize = (prod?.variations ?? []).filter((v) => v.size === item.size);
      const match =
        bySize.find((v) => (v.color ?? null) === (item.color ?? null)) ??
        (!item.color && bySize.length === 1 ? bySize[0] : undefined);
      if (match) {
        await tx.productVariation.update({
          where: { id: match.id },
          data: { stock: { decrement: item.quantity } },
        });
      }
    }

    // Eventos ERP na MESMA transição da baixa: `pedido_pago` (venda
    // confirmada — só em PAID real, nunca em pedido apenas criado) com
    // businessKey única por pedido; estoque atualizado junto do decremento.
    // Erro de fila aqui derruba a tx inteira (transição sem evento = não):
    // webhook/reconciliação reprocessam a confirmação.
    if (tx.erpEvent) {
      const erpDb = tx as unknown as DbErp;
      const pagoId = await enfileirarEvento(
        "pedido_pago",
        {
          numero: order.number,
          total: Number(String(order.total)),
          metodo_pagamento: order.paymentMethod,
          cupom: order.couponCode,
          itens: order.items.map((i) => ({
            produto_id: i.product.id,
            nome: i.productName,
            qtd: i.quantity,
            preco_unit: Number(String(i.unitPrice)),
          })),
        },
        { db: erpDb, businessKey: `pedido_pago:${order.id}` }
      );
      if (pagoId) eventosErp.push(pagoId);
      for (const [produto_id, estoque] of estoquesNovos) {
        const eid = await enfileirarEvento(
          "estoque_atualizado",
          { produto_id, estoque },
          { db: erpDb }
        );
        if (eid) eventosErp.push(eid);
      }
    }
  });

  // Pós-commit: entrega imediata (sem travar); sem config ERP a fila
  // fica PENDING e o dreno do cron entrega depois.
  for (const eventoId of eventosErp) {
    void entregarEvento(eventoId).catch((err) =>
      console.error("[finalizar:erp]", eventoId, err)
    );
  }

  // Link de acompanhamento no e-mail de confirmação: logado → /conta;
  // convidado → link privado novo (só se não existe token ativo).
  // Best-effort: falha de link nunca derruba a finalização.
  let linkAcompanhar: string | null = null;
  try {
    const { link } = await montarLinkAcompanhamento(
      { id: order.id, userId: order.userId ?? null, guestEmail: order.guestEmail },
      db as unknown as Parameters<typeof montarLinkAcompanhamento>[1]
    );
    linkAcompanhar = link;
  } catch (err) {
    console.error("[finalizar:link-acompanhar]", err);
  }

  // E-mail "pedido pago" via OUTBOX (antes: sendEmail direto — perdia a
  // mensagem se falhasse e podia duplicar em webhook repetido/concorrente).
  // A dedupeKey única (status:{orderId}:PAID) garante NO MÁXIMO UMA linha por
  // pedido: repetição PENDING→PAID não re-enfileira (a guarda de transição já
  // retorna cedo) e, mesmo que enfileirasse, o P2002 devolve a linha existente
  // → nenhum segundo envio. Fire-and-forget: não trava a finalização; falha
  // fica PENDING e o cron de dreno (09h/18h) retenta com backoff.
  const mail = emails.orderPaid(order.number, linkAcompanhar);
  void (async () => {
    try {
      const outboxId = await enfileirarEmail({
        dedupeKey: dedupeKeyStatusPedido(order.id, "PAID"),
        kind: "order_paid",
        orderId: order.id,
        mail: {
          to: order.user?.email || order.guestEmail || "",
          subject: mail.subject,
          text: mail.text,
        },
      });
      if (outboxId) await processarEmailOutbox(outboxId);
    } catch (err) {
      console.error("[finalizar:email]", err);
    }
  })();

  return { ok: true, jaFinalizado: false };
}
