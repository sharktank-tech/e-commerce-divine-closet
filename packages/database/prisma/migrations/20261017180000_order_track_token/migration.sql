-- Acompanhamento de pedido de convidado: token privado por pedido (1:1).
-- Só o hash é persistido; plaintext só no e-mail. Reenvio rotaciona o token.
CREATE TABLE "OrderTrackToken" (
    "id" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "sentTo" TEXT,
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTrackToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderTrackToken_orderId_key" ON "OrderTrackToken"("orderId");
CREATE UNIQUE INDEX "OrderTrackToken_tokenHash_key" ON "OrderTrackToken"("tokenHash");
CREATE INDEX "OrderTrackToken_expiresAt_idx" ON "OrderTrackToken"("expiresAt");

ALTER TABLE "OrderTrackToken" ADD CONSTRAINT "OrderTrackToken_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
