-- Ocorrência de negócio única: webhook/reprocesso repetido = 1 evento
-- (P2002 idempotente). NULL permitido (eventos livrístico de estoque/edição).
ALTER TABLE "ErpEvent" ADD COLUMN "businessKey" TEXT;
CREATE UNIQUE INDEX "ErpEvent_businessKey_key" ON "ErpEvent"("businessKey");
