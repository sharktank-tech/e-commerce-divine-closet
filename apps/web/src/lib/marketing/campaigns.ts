import { prisma } from "@/lib/prisma";
import { sendEmail, emailDriverAtual, EmailNaoAceito } from "@/lib/email";
import { verificarLimite } from "@/lib/rate-limit";

export const eligibleSubscriber = {
  status: "confirmed",
  consentVersion: { not: null },
  consentSource: { not: null },
};

export type DrainOptions = {
  driver?: string;
  send?: (msg: any) => Promise<{ id: string }>;
};

export function campaignRevision(campaign: any): string {
  return `${campaign.subject}:${campaign.body}:${campaign.status}:${campaign.source}`;
}

export async function queueCampaign(
  campaignId: string,
  operatorId: string,
  expectedCount: number,
  revision?: string
): Promise<{ queued: number }> {
  const campaign = await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId } });

  // Check revision
  if (revision) {
    const currentRevision = campaignRevision(campaign);
    if (currentRevision !== revision) {
      throw new Error("campanha mudou");
    }
  }

  // Check audience (source) hasn't changed
  // Get eligible subscribers
  const subscribers = await prisma.newsletterSubscriber.findMany({
    where: eligibleSubscriber,
  });

  // Check if audience count changed
  if (expectedCount !== subscribers.length) {
    throw new Error("público mudou");
  }

  // Create messages for each subscriber
  let queued = 0;
  for (const sub of subscribers) {
    const dedupeKey = `campaign:${campaignId}:${sub.id}`;
    try {
      await prisma.marketingMessage.create({
        data: {
          subscriberId: sub.id,
          campaignId,
          kind: "CAMPAIGN",
          dedupeKey,
          subject: campaign.subject,
          text: campaign.body,
          status: "PENDING",
        },
      });
      queued++;
    } catch (e: any) {
      if (e.code === "P2002") {
        // Already exists, skip
        continue;
      }
      throw e;
    }
  }

  return { queued };
}

export async function cancelCampaign(campaignId: string, operatorId: string): Promise<void> {
  await prisma.marketingCampaign.update({
    where: { id: campaignId },
    data: { status: "CANCELLED" },
  });
  // Cancel pending messages
  await prisma.marketingMessage.updateMany({
    where: { campaignId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
}

export async function drainMarketing(
  limit?: number,
  options: DrainOptions = {}
): Promise<{ simulated: boolean; processed: number }> {
  const driver = options.driver || "mock";
  const send = options.send;

  if (driver === "mock") {
    // Mock: don't send, don't mark as accepted
    return { simulated: true, processed: 0 };
  }

  // Get pending messages
  const messages = await prisma.marketingMessage.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: new Date() },
    },
    take: limit || 10,
    orderBy: { createdAt: "asc" },
  });

  let processed = 0;

  for (const msg of messages) {
    // Atomic claim: try to increment attempt to prevent double-send.
    // If count is 0, another worker already claimed this message.
    const claimed = await prisma.marketingMessage.updateMany({
      where: { id: msg.id, status: "PENDING", attempt: msg.attempt },
      data: { attempt: msg.attempt + 1 },
    });
    if (claimed.count === 0) {
      // Already claimed by another worker
      continue;
    }

    // Check suppression before sending
    const subscriber = await prisma.newsletterSubscriber.findUnique({
      where: { id: msg.subscriberId },
    });
    if (!subscriber || subscriber.status !== "confirmed") {
      await prisma.marketingMessage.update({
        where: { id: msg.id },
        data: { status: options.driver === "smtp" ? "REVIEW" : "SUPPRESSED" },
      });
      continue;
    }
    // Check if message was created before the subscriber's current confirmation
    // (re-subscription invalidates old messages)
    if (subscriber.confirmedAt && msg.createdAt < subscriber.confirmedAt) {
      await prisma.marketingMessage.update({
        where: { id: msg.id },
        data: { status: "SUPPRESSED" },
      });
      continue;
    }

    // Check if campaign is cancelled
    if (msg.campaignId) {
      const campaign = await prisma.marketingCampaign.findUnique({
        where: { id: msg.campaignId },
      });
      if (campaign && campaign.status === "CANCELLED") {
        await prisma.marketingMessage.update({
          where: { id: msg.id },
          data: { status: "CANCELLED" },
        });
        continue;
      }
    }

    // Try to send
    try {
      if (send) {
        const result = await send({
          idempotencyKey: msg.dedupeKey,
          to: subscriber.email,
          subject: msg.subject,
          text: msg.text,
        });
        await prisma.marketingMessage.update({
          where: { id: msg.id },
          data: {
            status: "ACCEPTED",
            acceptedAt: new Date(),
            providerId: result.id,
            firstAttemptAt: msg.firstAttemptAt || new Date(),
          },
        });
      }
      processed++;
    } catch (err: any) {
      const isRetryable = err instanceof EmailNaoAceito ? err.retryable : false;
      if (!isRetryable) {
        await prisma.marketingMessage.update({
          where: { id: msg.id },
          data: {
            status: "FAILED",
            lastError: err.message,
          },
        });
      } else {
        // Retry with backoff
        const backoffMs = Math.min(2 ** (msg.attempt + 1), 60) * 60 * 1000;
        await prisma.marketingMessage.update({
          where: { id: msg.id },
          data: {
            status: "PENDING",
            nextAttemptAt: new Date(Date.now() + backoffMs),
            lastError: err.message,
            firstAttemptAt: msg.firstAttemptAt || new Date(),
          },
        });
        // SMTP transient → REVIEW
        if (options.driver === "smtp") {
          await prisma.marketingMessage.update({
            where: { id: msg.id },
            data: { status: "REVIEW" },
          });
        }
      }
    }
  }

  return { simulated: false, processed };
}
