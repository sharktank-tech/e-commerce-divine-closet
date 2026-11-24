CREATE TABLE "AnalyticsBrowserConsent" (
 "id" UUID NOT NULL,
 "state" "AnalyticsConsentState" NOT NULL DEFAULT 'UNKNOWN',
 "grantedAt" TIMESTAMP(3),
 "revokedAt" TIMESTAMP(3),
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AnalyticsBrowserConsent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsBrowserConsent_state_expiresAt_idx" ON "AnalyticsBrowserConsent"("state","expiresAt");
