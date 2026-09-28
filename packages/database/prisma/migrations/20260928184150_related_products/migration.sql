-- AlterTable (vínculo manual opcional; default vazio)
ALTER TABLE "Product" ADD COLUMN "relacionados" TEXT[] NOT NULL DEFAULT '{}';

-- Reversão (manual, se necessário):
-- ALTER TABLE "Product" DROP COLUMN "relacionados";
