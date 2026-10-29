-- Aditiva. Newsletter original ainda não publicada; preservar o histórico anterior.
ALTER TABLE "NewsletterSubscriber"
 ADD COLUMN "tokenVersion" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
 ADD COLUMN "confirmNonce" TEXT,
 ADD COLUMN "confirmExpiresAt" TIMESTAMP(3),
 ADD COLUMN "lastConfirmationAt" TIMESTAMP(3);
-- Tokens antigos sem separação de finalidade não autorizam novas operações.
UPDATE "NewsletterSubscriber" SET "unsubscribeToken" = NULL;
ALTER TABLE "NewsletterSubscriber" ADD CONSTRAINT "newsletter_status" CHECK (status IN ('pending','confirmed','unsubscribed'));
CREATE TABLE "MarketingCampaign" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), subject TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','QUEUED','CANCELLED')),
 source TEXT, "createdBy" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "MarketingMessage" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "subscriberId" UUID NOT NULL REFERENCES "NewsletterSubscriber"(id),
 "campaignId" UUID REFERENCES "MarketingCampaign"(id), kind TEXT NOT NULL CHECK (kind IN ('CONFIRM','CAMPAIGN')),
 "dedupeKey" TEXT NOT NULL UNIQUE, subject TEXT NOT NULL, text TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','FAILED','SUPPRESSED','CANCELLED','REVIEW')),
 attempt INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "firstAttemptAt" TIMESTAMP(3), "acceptedAt" TIMESTAMP(3), "providerId" TEXT, "lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "MarketingMessage_status_nextAttemptAt_idx" ON "MarketingMessage"(status,"nextAttemptAt");
CREATE INDEX "MarketingMessage_campaignId_status_idx" ON "MarketingMessage"("campaignId",status);
DO $$ DECLARE t text; role_name text; BEGIN
 FOREACH t IN ARRAY ARRAY['NewsletterSubscriber','MarketingCampaign','MarketingMessage'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,role_name);
   END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='divine_app') THEN
   EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO divine_app',t);
   EXECUTE format('CREATE POLICY divine_app_full ON public.%I FOR ALL TO divine_app USING (true) WITH CHECK (true)',t);
  END IF;
 END LOOP;
END $$;
