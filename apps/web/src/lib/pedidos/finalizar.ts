import { prisma } from "@/lib/prisma";
import { emails, sendEmail } from "@/lib/email";
import { invalidarCupom } from "@/lib/cupom-cache";

// Pós-aprovação do pedido — caminho único para confirmação síncrona
// (mock/cartão aprovado na hora) e assíncrona (Pix via webhook do MP).
// Idempotente: só transita PENDING → PAID uma vez; repetição (webhook
// reenviado) não duplica baixa de estoque, cupom nem e-mail.

type BancoFinalizar = {
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
    update(args: unknown): Promise<unknown>;
  };
  coupon: { update(args: unknown): Promise<unknown> };
  product: { update(args: unknown): Promise<unknown> };
  productVariation: {
    findMany(args: unknown): Promise<
      Array<{ id: string; size: string; color: string | null }>
    >;
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

  await db.order.update({
    where: { id: order.id },
    data: {
      status: "PAID",
      paymentStatus: "PAID",
      ...(paymentId ? { paymentId } : {}),
    },
  });

  if (order.couponCode) {
    await db.coupon.update({
      where: { code: order.couponCode },
      data: { usedCount: { increment: 1 } },
    });
    invalidarCupom(order.couponCode);
  }

  for (const item of order.items) {
    await db.product.update({
      where: { id: item.product.id },
      data: { stock: { decrement: item.quantity } },
    });
    const vars = await db.productVariation.findMany({
      where: { productId: item.product.id },
    });
    const bySize = vars.filter((v) => v.size === item.size);
    const match =
      bySize.find((v) => (v.color ?? null) === (item.color ?? null)) ??
      (!item.color && bySize.length === 1 ? bySize[0] : undefined);
    if (match) {
      await db.productVariation.update({
        where: { id: match.id },
        data: { stock: { decrement: item.quantity } },
      });
    }
  }

  const mail = emails.orderPaid(order.number);
  sendEmail({
    to: order.user?.email || order.guestEmail || "",
    subject: mail.subject,
    text: mail.text,
  }).catch((err) => console.error("[finalizar:email]", err));

  return { ok: true, jaFinalizado: false };
}
