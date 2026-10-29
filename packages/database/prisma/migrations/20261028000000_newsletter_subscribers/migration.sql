-- Migration: newsletter_subscribers (aditiva, não destrutiva)
-- Base para cadastro de interessados e descadastro.

CREATE TABLE IF NOT EXISTS "NewsletterSubscriber" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "consentVersion" TEXT,
    "consentSource" TEXT,
    "consentedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "unsubscribeToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "NewsletterSubscriber_unsubscribeToken_key" ON "NewsletterSubscriber"("unsubscribeToken");
CREATE INDEX IF NOT EXISTS "NewsletterSubscriber_status_idx" ON "NewsletterSubscriber"("status");
CREATE INDEX IF NOT EXISTS "NewsletterSubscriber_createdAt_idx" ON "NewsletterSubscriber"("createdAt");
