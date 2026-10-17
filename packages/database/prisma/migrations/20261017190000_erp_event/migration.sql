-- Fila persistente de eventos ERP (fire-and-forget + backoff + dreno no cron).
CREATE TYPE "ErpEventStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'DEAD');

CREATE TABLE "ErpEvent" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ErpEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ErpEvent_status_nextAttemptAt_idx" ON "ErpEvent"("status", "nextAttemptAt");
