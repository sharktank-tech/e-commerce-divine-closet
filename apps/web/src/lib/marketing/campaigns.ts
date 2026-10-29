import { prisma } from "@/lib/prisma";
import { marketingBaseUrl, marketingToken } from "./tokens";
import {
  emailDriverAtual,
  sendEmail,
  EmailNaoAceito,
  type SendEmailInput,
} from "@/lib/email";

export async function queueCampaign(
  id: string,
  operator: string,
  expected: number,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MarketingCampaign" WHERE id=${id}::uuid FOR UPDATE`;
    const c = await tx.marketingCampaign.findUniqueOrThrow({ where: { id } });
    if (c.status !== "DRAFT") return { queued: 0, alreadyQueued: true };
    const subscribers = await tx.newsletterSubscriber.findMany({
      where: {
        status: "confirmed",
        ...(c.source ? { consentSource: c.source } : {}),
      },
      orderBy: { id: "asc" },
      take: 1001,
    });
    if (subscribers.length > 1000)
      throw new Error("Limite desta versão: 1000 destinatários por campanha.");
    if (subscribers.length !== expected)
      throw new Error("O público mudou. Atualize a prévia antes de confirmar.");
    await tx.marketingMessage.createMany({
      data: subscribers.map((s) => ({
        subscriberId: s.id,
        campaignId: id,
        kind: "CAMPAIGN",
        dedupeKey: `campaign:${id}:${s.id}`,
        subject: c.subject,
        text: `${c.body}\n\nCancelar inscrição: ${marketingBaseUrl()}/newsletter/cancelar?token=${marketingToken(s.id, s.tokenVersion, "unsubscribe")}`,
      })),
      skipDuplicates: true,
    });
    await tx.marketingCampaign.update({
      where: { id },
      data: { status: "QUEUED" },
    });
    await tx.auditLog.create({
      data: {
        userId: operator,
        action: "marketing_campaign_queued",
        entity: "MarketingCampaign",
        entityId: id,
        meta: { recipients: subscribers.length },
      },
    });
    return { queued: subscribers.length };
  });
}
export async function cancelCampaign(id: string, operator: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MarketingCampaign" WHERE id=${id}::uuid FOR UPDATE`;
    await tx.marketingCampaign.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
    const cancelled = await tx.marketingMessage.updateMany({
      where: { campaignId: id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    await tx.auditLog.create({
      data: {
        userId: operator,
        action: "marketing_campaign_cancelled",
        entity: "MarketingCampaign",
        entityId: id,
        meta: { cancelled: cancelled.count },
      },
    });
    return { cancelled: cancelled.count };
  });
}

type Transport = {
  driver: string;
  send: (input: SendEmailInput) => Promise<{ id?: string }>;
};
// Dependência injetável só para testes do serviço; a API nunca recebe driver/transport.
export async function drainMarketing(
  limit = 10,
  transport: Transport = { driver: emailDriverAtual(), send: sendEmail },
) {
  if (transport.driver === "mock") return { simulated: true, processed: 0 };
  if (!["smtp", "resend"].includes(transport.driver))
    throw new Error("Transporte indisponível");
  let processed = 0;
  for (let i = 0; i < Math.min(10, Math.max(0, limit)); i++) {
    const candidate = await prisma.marketingMessage.findFirst({
      where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
      orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    });
    if (!candidate) break;
    // Claim durável antes do transporte. Queda/timeout incerto fica em REVIEW,
    // nunca volta automaticamente à fila (inclusive SMTP sem idempotência).
    const claim = await prisma.marketingMessage.updateMany({
      where: { id: candidate.id, status: "PENDING", nextAttemptAt: { lte: new Date() } },
      data: { status: "REVIEW", firstAttemptAt: candidate.firstAttemptAt || new Date() },
    });
    if (!claim.count) continue;
    const changed = await prisma.$transaction(
      async (tx) => {
        // Ordem global: campanha -> assinante -> mensagem. Cancelar espera envio iniciado terminar.
        if (candidate.campaignId)
          await tx.$queryRaw`SELECT id FROM "MarketingCampaign" WHERE id=${candidate.campaignId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "NewsletterSubscriber" WHERE id=${candidate.subscriberId}::uuid FOR UPDATE`;
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "MarketingMessage" WHERE id=${candidate.id}::uuid AND status='REVIEW' FOR UPDATE SKIP LOCKED`;
        if (!locked.length) return false;
        const m = await tx.marketingMessage.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        const s = await tx.newsletterSubscriber.findUniqueOrThrow({
          where: { id: m.subscriberId },
        });
        const campaign = m.campaignId
          ? await tx.marketingCampaign.findUnique({
              where: { id: m.campaignId },
            })
          : null;
        const staleConfirm =
          m.kind === "CONFIRM" &&
          (!s.confirmNonce ||
            !m.dedupeKey.endsWith(s.confirmNonce) ||
            !s.confirmExpiresAt ||
            s.confirmExpiresAt <= new Date());
        if (
          staleConfirm ||
          (m.kind === "CAMPAIGN" &&
            (s.status !== "confirmed" || campaign?.status !== "QUEUED"))
        ) {
          await tx.marketingMessage.update({
            where: { id: m.id },
            data: {
              status:
                campaign?.status === "CANCELLED" ? "CANCELLED" : "SUPPRESSED",
            },
          });
          return true;
        }
        const now = new Date();
        if (
          m.firstAttemptAt &&
          now.getTime() - m.firstAttemptAt.getTime() >= 23 * 3_600_000
        ) {
          await tx.marketingMessage.update({
            where: { id: m.id },
            data: {
              status: "REVIEW",
              lastError:
                "Janela de idempotência expirada; revisão manual necessária.",
            },
          });
          return true;
        }
        const attempt = m.attempt + 1;
        try {
          const result = await transport.send({
            to: s.email,
            subject: m.subject,
            text: m.text,
            idempotencyKey: m.dedupeKey,
          });
          await tx.marketingMessage.update({
            where: { id: m.id },
            data: {
              status: "ACCEPTED",
              attempt,
              firstAttemptAt: m.firstAttemptAt || now,
              acceptedAt: now,
              providerId: result.id || null,
              lastError: null,
            },
          });
        } catch (e) {
          const retryable = e instanceof EmailNaoAceito && e.retryable;
          // SMTP não tem deduplicação: falha incerta exige revisão em vez de repetir.
          const status =
            transport.driver === "smtp"
              ? "REVIEW"
              : retryable && attempt < 5
                ? "PENDING"
                : e instanceof EmailNaoAceito
                  ? "FAILED"
                  : "REVIEW";
          await tx.marketingMessage.update({
            where: { id: m.id },
            data: {
              status,
              attempt,
              firstAttemptAt: m.firstAttemptAt || now,
              nextAttemptAt: new Date(
                now.getTime() + Math.min(60, 2 ** attempt) * 60_000,
              ),
              lastError: retryable
                ? "Falha transitória no transporte."
                : "Transporte não confirmou aceitação; consulte o provedor.",
            },
          });
        }
        return true;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    if (changed) processed++;
  }
  return { simulated: false, processed };
}
