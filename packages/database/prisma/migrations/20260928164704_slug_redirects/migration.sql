-- CreateTable
CREATE TABLE "SlugRedirect" (
    "oldSlug" TEXT NOT NULL,
    "newSlug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlugRedirect_pkey" PRIMARY KEY ("oldSlug")
);

-- Reversão (manual, se necessário): DROP TABLE "SlugRedirect";
