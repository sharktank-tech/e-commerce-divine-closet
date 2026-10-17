-- Estorno de pedido (1:1, integral) via Mercado Pago.
-- Não altera Order — a marcação REFUNDED do pedido ocorre só em código,
-- após confirmação real (APPROVED) do provedor.
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'IN_PROCESS', 'APPROVED', 'REJECTED');

CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "mpRefundId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "requestedBy" UUID,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Refund_orderId_key" ON "Refund"("orderId");
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");
CREATE INDEX "Refund_status_idx" ON "Refund"("status");
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
