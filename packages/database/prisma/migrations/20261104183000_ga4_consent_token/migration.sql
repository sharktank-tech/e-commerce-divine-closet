ALTER TABLE "AnalyticsOrderIdentity" ADD COLUMN "consentTokenId" UUID;
CREATE INDEX "AnalyticsOrderIdentity_consentTokenId_idx" ON "AnalyticsOrderIdentity"("consentTokenId");
