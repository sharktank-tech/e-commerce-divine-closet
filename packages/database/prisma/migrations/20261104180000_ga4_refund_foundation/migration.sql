-- GA4.2: modelo inativo. Nenhuma coleta, emissão ou backfill é ativado.
CREATE TYPE "AnalyticsConsentState" AS ENUM ('UNKNOWN','GRANTED','DENIED','REVOKED');
CREATE TYPE "AnalyticsEventStatus" AS ENUM ('PENDING','PROCESSING','ACCEPTED','FAILED','SKIPPED');

CREATE TABLE "AnalyticsOrderIdentity" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "clientId" VARCHAR(128),
  "consentState" "AnalyticsConsentState" NOT NULL DEFAULT 'UNKNOWN',
  "consentProofAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalyticsOrderIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalyticsOrderIdentity_orderId_key" ON "AnalyticsOrderIdentity"("orderId");
ALTER TABLE "AnalyticsOrderIdentity"
  ADD CONSTRAINT "AnalyticsOrderIdentity_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AnalyticsEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "eventType" VARCHAR(32) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "AnalyticsEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalyticsEvent_dedupeKey_key" ON "AnalyticsEvent"("dedupeKey");
CREATE INDEX "AnalyticsEvent_status_nextAttemptAt_idx" ON "AnalyticsEvent"("status","nextAttemptAt");
CREATE INDEX "AnalyticsEvent_orderId_eventType_idx" ON "AnalyticsEvent"("orderId","eventType");
ALTER TABLE "AnalyticsEvent"
  ADD CONSTRAINT "AnalyticsEvent_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
