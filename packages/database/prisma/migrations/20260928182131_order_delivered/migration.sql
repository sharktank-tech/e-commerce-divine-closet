-- AlterTable (opcional; rastreio da entrega para o convite de avaliação)
ALTER TABLE "Order" ADD COLUMN "entregueEm" TIMESTAMP(3);

-- Reversão (manual, se necessário):
-- ALTER TABLE "Order" DROP COLUMN "entregueEm";
