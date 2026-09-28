-- CreateTable
CREATE TABLE "SizeTable" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'cm',
    "columns" JSONB NOT NULL DEFAULT '[]',
    "rows" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SizeTable_pkey" PRIMARY KEY ("id")
);

-- AlterTable (colunas opcionais; nada existente é tocado)
ALTER TABLE "Product" ADD COLUMN "tabelaMedidasId" UUID,
ADD CONSTRAINT "Product_tabelaMedidasId_fkey" FOREIGN KEY ("tabelaMedidasId") REFERENCES "SizeTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN "sizeTableId" UUID,
ADD CONSTRAINT "Category_sizeTableId_fkey" FOREIGN KEY ("sizeTableId") REFERENCES "SizeTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reversão (manual, se necessário):
-- ALTER TABLE "Product" DROP CONSTRAINT "Product_tabelaMedidasId_fkey";
-- ALTER TABLE "Product" DROP COLUMN "tabelaMedidasId";
-- ALTER TABLE "Category" DROP CONSTRAINT "Category_sizeTableId_fkey";
-- ALTER TABLE "Category" DROP COLUMN "sizeTableId";
-- DROP TABLE "SizeTable";
