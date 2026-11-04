import { prisma } from "@/lib/prisma";
import { submitGa4Refund } from "@/lib/ga4-transport";
import type { Ga4TransportResult } from "@/lib/ga4-transport";
import type { Ga4RefundEvent } from "@/lib/ga4-refund";

/**
 * Outbox GA4.2: processador sem endpoint público.
 * Transporte hard-off: submitGa4Refund sempre retorna DISABLED.
 * O lease protege contra dois workers que reivindicam a mesma intenção;
 * não promete dedupe externa se a resposta do MP se perde.
 */
export async function processOneGa4Refund(): Promise<
  "EMPTY" | "DISABLED" | "SKIPPED" | "ACCEPTED_UNVERIFIED" | "UNCERTAIN" | "RETRY"
> {
  // Hard-off deliberado e incondicional antes de qualquer claim.
  // Ativação futura exige outra revisão e sincronização completa de revogações.
  if (process.env.GA4_REFUND_TRANSPORT_ENABLED !== "true") return "DISABLED";
  // Mesmo com flag definida, submitGa4Refund permanece hard-off:
  // a flag sozinha nunca habilita egress.
  const now = new Date();
  const eligible = {
    OR: [
      { status: "PENDING" as const, nextAttemptAt: { lte: now } },
      // Lease expirado representa resultado externo incerto. NÃO reenvie automaticamente.
      // Um processo de reconciliação/manual deverá resolver esses casos.

    ],
  };
  const candidate = await prisma.analyticsEvent.findFirst({
    where: { ...eligible, eventType: "refund" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!candidate) return "EMPTY";
  const claim = await prisma.analyticsEvent.updateMany({
    where: { id: candidate.id, ...eligible },
    data: { status: "PROCESSING", leaseUntil: new Date(now.getTime() + 120000),
      attempt: { increment: 1 } },
  });
  if (claim.count !== 1) return "EMPTY";

  const entry = await prisma.analyticsEvent.findUnique({
    where: { id: candidate.id },
    include: { order: { include: { refund: true, analyticsIdentity: true } } },
  });
  const order = entry?.order;
  const identity = order?.analyticsIdentity;
  const consent = identity?.consentTokenId
    ? await prisma.analyticsBrowserConsent.findUnique({ where: { id: identity.consentTokenId } })
    : null;
  if (!entry || !order || order.paymentStatus !== "REFUNDED" ||
      order.refund?.status !== "APPROVED" ||
      !identity || identity.consentState !== "GRANTED" || identity.revokedAt ||
      !identity.consentProofAt || !identity.clientId ||
      !/^\d+\.\d+$/.test(identity.clientId) ||
      !consent || consent.state !== "GRANTED" || consent.revokedAt ||
      consent.expiresAt <= new Date()) {
    await prisma.analyticsEvent.updateMany({
      where: { id: candidate.id, status: "PROCESSING" },
      data: { status: "SKIPPED", leaseUntil: null, lastError: "not_authorized" },
    });
    return "SKIPPED";
  }

  const payload = entry.payload as unknown as Ga4RefundEvent["params"];
  // A fila só aceita refund com o UUID do próprio pedido.
  if (!payload || typeof payload !== "object" ||
      payload.transaction_id !== order.id || payload.currency !== "BRL" ||
      typeof payload.value !== "number" || !Number.isFinite(payload.value) ||
      payload.value < 0 || typeof payload.shipping !== "number" ||
      !Number.isFinite(payload.shipping) || payload.shipping < 0 ||
      !Array.isArray(payload.items)) {
    await prisma.analyticsEvent.updateMany({
      where: { id: entry.id, status: "PROCESSING" },
      data: { status: "SKIPPED", leaseUntil: null, lastError: "invalid_payload" },
    });
    return "SKIPPED";
  }
  let result: Ga4TransportResult;
  try {
    result = await submitGa4Refund({
      clientId: identity.clientId,
      event: { name: "refund", params: payload },
    });
  } catch {
    result = { kind: "UNCERTAIN" };
  }

  if (result.kind === "DISABLED") {
    await prisma.analyticsEvent.updateMany({
      where: { id: entry.id, status: "PROCESSING" },
      data: { status: "PENDING", leaseUntil: null },
    });
    return "DISABLED";
  }
  if (result.kind === "ACCEPTED_UNVERIFIED") {
    await prisma.analyticsEvent.updateMany({
      where: { id: entry.id, status: "PROCESSING" },
      data: { status: "ACCEPTED", leaseUntil: null, acceptedAt: new Date() },
    });
    return "ACCEPTED_UNVERIFIED";
  }
  if (result.kind === "UNCERTAIN") {
    // Resposta perdida: retry cego poderia duplicar refund no GA4.
    // Fica FAILED para revisão operacional, sem envio automático.
    await prisma.analyticsEvent.updateMany({
      where: { id: entry.id, status: "PROCESSING" },
      data: { status: "FAILED", leaseUntil: null, lastError: "delivery_uncertain" },
    });
    return "UNCERTAIN";
  }
  await prisma.analyticsEvent.updateMany({
    where: { id: entry.id, status: "PROCESSING" },
    data: { status: "PENDING", leaseUntil: null,
      nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000), lastError: "transport_rejected" },
  });
  return "RETRY";
}
