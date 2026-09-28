-- AlterTable (todos opcionais; nenhum dado existente é tocado)
ALTER TABLE "Product" ADD COLUMN "composicao" TEXT,
ADD COLUMN "instrucoesLavagem" TEXT,
ADD COLUMN "comprimento" TEXT,
ADD COLUMN "modeloAltura" TEXT,
ADD COLUMN "modeloVeste" TEXT,
ADD COLUMN "caimento" TEXT,
ADD COLUMN "ocasiao" TEXT,
ADD COLUMN "metaTitle" TEXT,
ADD COLUMN "metaDescription" TEXT;

-- Reversão (manual, se necessário):
-- ALTER TABLE "Product" DROP COLUMN "composicao", DROP COLUMN "instrucoesLavagem", DROP COLUMN "comprimento", DROP COLUMN "modeloAltura", DROP COLUMN "modeloVeste", DROP COLUMN "caimento", DROP COLUMN "ocasiao", DROP COLUMN "metaTitle", DROP COLUMN "metaDescription";
