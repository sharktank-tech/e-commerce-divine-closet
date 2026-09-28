-- AlterTable (arrays paralelos a images; default vazio = sem metadados)
ALTER TABLE "Product" ADD COLUMN "imageColors" TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN "imageAlts" TEXT[] NOT NULL DEFAULT '{}';

-- Reversão (manual, se necessário):
-- ALTER TABLE "Product" DROP COLUMN "imageColors", DROP COLUMN "imageAlts";
