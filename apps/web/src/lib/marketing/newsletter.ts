import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";
import { marketingToken, verifyMarketingToken } from "./tokens";
import { sendEmail } from "@/lib/email";

const CONFIRM_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function requestSubscription(
  email: string,
  source: string,
  reactivation: boolean = false
): Promise<void> {
  const normalized = email.toLowerCase().trim();
  const now = new Date();

  const existing = await prisma.newsletterSubscriber.findUnique({
    where: { email: normalized },
  });

  if (existing) {
    if (existing.status === "unsubscribed") {
      if (!reactivation) {
        // Repeat subscription doesn't reactivate
        return;
      }
      // Reactivation requires new confirmation
      const lastConfirm = existing.lastConfirmationAt;
      const recent = lastConfirm && (now.getTime() - lastConfirm.getTime()) < CONFIRM_EXPIRY_MS;
      if (!recent) {
        const nonce = randomUUID();
        await prisma.newsletterSubscriber.update({
          where: { id: existing.id },
          data: {
            confirmNonce: nonce,
            confirmExpiresAt: new Date(now.getTime() + CONFIRM_EXPIRY_MS),
            lastConfirmationAt: now,
          },
        });
        await sendEmail({
          to: normalized,
          subject: "Confirme sua inscrição",
          text: `Token: ${marketingToken(existing.id, nonce, "confirm")}`,
        });
      }
      return;
    }
    // Already pending or confirmed: don't reactivate, don't send new confirmation
    return;
  }

  // New subscriber
  const nonce = randomUUID();
  const tokenVersion = randomUUID();
  let subscriber;
  try {
    subscriber = await prisma.newsletterSubscriber.create({
      data: {
        email: normalized,
        status: "pending",
        consentVersion: "1.0",
        consentSource: source,
        consentedAt: now,
        confirmNonce: nonce,
        confirmExpiresAt: new Date(now.getTime() + CONFIRM_EXPIRY_MS),
        lastConfirmationAt: now,
        tokenVersion,
        unsubscribeToken: null,
      },
    });
  } catch (e: any) {
    if (e.code === "P2002") {
      // Already exists (race condition) - find and return
      subscriber = await prisma.newsletterSubscriber.findUnique({ where: { email: normalized } });
      if (!subscriber) throw e;
      // Don't create another MarketingMessage
      return;
    }
    throw e;
  }

  // Create confirmation message (idempotent)
  try {
    await prisma.marketingMessage.create({
      data: {
        subscriberId: subscriber.id,
        kind: "CONFIRM",
        dedupeKey: `confirm:${subscriber.id}`,
        subject: "Confirme sua inscrição",
        text: `Token: ${marketingToken(subscriber.id, nonce, "confirm")}`,
        status: "PENDING",
      },
    });
  } catch (e: any) {
    if (e.code !== "P2002") throw e;
  }

  // Send confirmation email (simulated in tests)
  // Only send if subscriber was just created (not in race condition)

}

export async function applyNewsletterToken(
  token: string,
  action: "confirm" | "unsubscribe"
): Promise<boolean> {
  const parsed = verifyMarketingToken(token);
  if (!parsed) return false;

  const { id, version, action: tokenAction } = parsed;
  if (tokenAction !== action) return false;

  const subscriber = await prisma.newsletterSubscriber.findUnique({
    where: { id },
  });
  if (!subscriber) return false;

  // Check expiry for confirm
  if (action === "confirm") {
    if (subscriber.confirmExpiresAt && subscriber.confirmExpiresAt < new Date()) {
      return false;
    }
    // Check version matches
    if (subscriber.confirmNonce !== version) return false;
    if (subscriber.status === "confirmed") return false; // already confirmed

    await prisma.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: { status: "confirmed", confirmedAt: new Date() },
    });
    return true;
  }

  if (action === "unsubscribe") {
    // Check version matches tokenVersion
    if (subscriber.tokenVersion !== version) return false;
    if (subscriber.status === "unsubscribed") return true; // idempotent

    await prisma.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: { status: "unsubscribed", unsubscribedAt: new Date() },
    });
    return true;
  }

  return false;
}

export const GENERIC_NEWSLETTER = { ok: true, message: "Se o e-mail estiver elegível, você receberá uma confirmação." };

export async function newsletterLimit(req: any, email?: string): Promise<boolean> {
  // Rate limit: 5 cadastros por hora por IP
  const { verificarLimite } = await import("@/lib/rate-limit");
  const chave = `newsletter-subscribe:${req.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido"}`;
  const limite = verificarLimite(chave, { janelaMs: 3_600_000, maximo: 5 });
  return limite.permitido;
}
