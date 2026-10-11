import { prisma } from "@/lib/prisma";
import { emails, sendEmail } from "@/lib/email";
import { invalidarCupom } from "@/lib/cupom-cache";

// Pós-aprovação do pedido — caminho único para confirmação síncrona
// (mock/cartão aprovado na hora) e assíncrona (Pix via webhook do MP).
// Idempotente: só transita PENDING → PAID uma vez; repetição (webhook
// reenviado) não duplica baixa de estoque, cupom nem e-mail.
// Concorrência: trava as linhas dos produtos (FOR UPDATE) e revalida o
// estoque DENTRO da transação — dois checkouts do último item em estoque
// não vendem além do disponível. I/O externo (e-mail) fica fora da tx.

type BancoFinalizar = {
  $transaction(fn: (tx: TxFinalizar) => Promise<unknown>): Promise<unknown>;
  order: {
    findUnique(args: unknown): Promise<{
      id: string;
      number: string;
      paymentStatus: string;
      guestEmail: string | null;
      couponCode: string | null;
      user: { email: string } | null;
      items: Array<{
        quantity: number;
        size: string | null;
        color: string | null;
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
  });

  const mail = emails.orderPaid(order.number);
  sendEmail({
    to: order.user?.email || order.guestEmail || "",
    subject: mail.subject,
    text: mail.text,
  }).catch((err) => console.error("[finalizar:email]", err));

  return { ok: true, jaFinalizado: false };
}
