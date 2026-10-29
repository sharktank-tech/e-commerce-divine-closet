import { randomUUID, createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { consumirRateLimit, ipDoPedido } from "@/lib/rate-limit";
import {
  CONSENT_VERSION,
  marketingBaseUrl,
  marketingToken,
  tokenId,
  tokenMatches,
} from "./tokens";

export const GENERIC_NEWSLETTER = {
  ok: true,
  message:
    "Se o endereço estiver elegível, você receberá as instruções por e-mail.",
};
export async function newsletterLimit(req: Request, email?: string) {
  const ip = createHash("sha256").update(ipDoPedido(req.headers)).digest("hex");
  const a = await consumirRateLimit(`newsletter:ip:${ip}`, {
    limite: 10,
    janelaMin: 60,
  });
  const b = email
    ? await consumirRateLimit(
        `newsletter:email:${createHash("sha256").update(email).digest("hex")}`,
        { limite: 3, janelaMin: 60 },
      )
    : { permitido: true };
  return a.permitido && b.permitido;
}
// Linha do assinante serializa confirmação, cancelamento e envio promocional.
export async function requestSubscription(
  email: string,
  source: string,
  reactivate: boolean,
) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.newsletterSubscriber.createMany({
      data: [
        {
          email,
          status: "pending",
          consentVersion: CONSENT_VERSION,
          consentSource: source,
          consentedAt: now,
        },
      ],
      skipDuplicates: true,
    });
    await tx.$queryRaw`SELECT id FROM "NewsletterSubscriber" WHERE email=${email} FOR UPDATE`;
    const s = await tx.newsletterSubscriber.findUniqueOrThrow({
      where: { email },
    });
    if (
      s.status === "confirmed" ||
      (s.status === "unsubscribed" && !reactivate)
    )
      return;
    if (
      s.lastConfirmationAt &&
      now.getTime() - s.lastConfirmationAt.getTime() < 3_600_000
    )
      return;
    const nonce = randomUUID();
    await tx.newsletterSubscriber.update({
      where: { id: s.id },
      data: {
        confirmNonce: nonce,
        confirmExpiresAt: new Date(now.getTime() + 86_400_000),
        lastConfirmationAt: now,
        consentVersion: CONSENT_VERSION,
        consentSource: source,
        consentedAt: now,
      },
    });
    const token = marketingToken(s.id, nonce, "confirm");
    await tx.marketingMessage.create({
      data: {
        subscriberId: s.id,
        kind: "CONFIRM",
        dedupeKey: `confirm:${s.id}:${nonce}`,
        subject: "Confirme sua inscrição — Divine Closet",
        text: `Confirme o recebimento de novidades e ofertas (link válido por 24 horas):\n${marketingBaseUrl()}/newsletter/confirmar?token=${token}\nSe não solicitou, ignore esta mensagem.`,
      },
    });
  });
}
export async function applyNewsletterToken(
  token: unknown,
  action: "confirm" | "unsubscribe",
) {
  const id = tokenId(token);
  if (!id) return false;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "NewsletterSubscriber" WHERE id=${id}::uuid FOR UPDATE`;
    const s = await tx.newsletterSubscriber.findUnique({ where: { id } });
    if (!s) return false;
    if (action === "confirm") {
      if (
        !s.confirmNonce ||
        !s.confirmExpiresAt ||
        s.confirmExpiresAt <= new Date() ||
        !tokenMatches(token as string, id, s.confirmNonce, "confirm")
      )
        return false;
      await tx.newsletterSubscriber.update({
        where: { id },
        data: {
          status: "confirmed",
          confirmedAt: new Date(),
          unsubscribedAt: null,
          confirmNonce: null,
          confirmExpiresAt: null,
        },
      });
    } else {
      if (!tokenMatches(token as string, id, s.tokenVersion, "unsubscribe"))
        return false;
      await tx.newsletterSubscriber.update({
        where: { id },
        data: {
          status: "unsubscribed",
          unsubscribedAt: s.unsubscribedAt || new Date(),
          confirmNonce: null,
          confirmExpiresAt: null,
        },
      });
    }
    return true;
  });
}
export type MarketingTx = Prisma.TransactionClient;
