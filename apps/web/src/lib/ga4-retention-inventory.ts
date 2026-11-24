import { prisma } from "@/lib/prisma";

/**
 * Relatório APENAS LEITURA de candidatos à revisão de retenção GA4.2.
 *
 * Nenhum endpoint/cron chama esta função. Um relatório não autoriza exclusão:
 * a política legal, casos de auditoria e o plano de descarte ainda precisam
 * de aprovação. Não retorna IDs de pedidos, tokens, client IDs nem payload.
 */
export type Ga4RetentionCutoffs = {
  browserBefore: Date;
  identityBefore: Date;
  terminalEventBefore: Date;
  auditBefore: Date;
};

export async function previewGa4Retention(
  cutoffs: Ga4RetentionCutoffs,
  now: Date = new Date(),
): Promise<{
  dryRun: true;
  candidates: {
    browserConsents: number;
    revokedIdentities: number;
    terminalEvents: number;
    consentAuditLogs: number;
  };
  manualReview: { processing: number; failed: number };
}> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error("invalid_retention_now");
  for (const date of Object.values(cutoffs)) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || date.getTime() > now.getTime())
      throw new Error("invalid_retention_cutoff");
  }
  const [
    browserConsents, revokedIdentities, terminalEvents, consentAuditLogs,
    processing, failed,
  ] = await Promise.all([
    prisma.analyticsBrowserConsent.count({
      where: {
        OR: [
          { state: "REVOKED", revokedAt: { lte: cutoffs.browserBefore } },
          { expiresAt: { lte: cutoffs.browserBefore } },
        ],
      },
    }),
    prisma.analyticsOrderIdentity.count({
      where: { consentState: "REVOKED", revokedAt: { lte: cutoffs.identityBefore } },
    }),
    prisma.analyticsEvent.count({
      where: {
        status: { in: ["SKIPPED", "ACCEPTED"] },
        updatedAt: { lte: cutoffs.terminalEventBefore },
      },
    }),
    prisma.auditLog.count({
      where: {
        action: { in: ["ga4_consent_granted", "ga4_consent_revoked"] },
        createdAt: { lte: cutoffs.auditBefore },
      },
    }),
    prisma.analyticsEvent.count({ where: { status: "PROCESSING" } }),
    prisma.analyticsEvent.count({ where: { status: "FAILED" } }),
  ]);
  return {
    dryRun: true,
    candidates: { browserConsents, revokedIdentities, terminalEvents, consentAuditLogs },
    manualReview: { processing, failed },
  };
}
