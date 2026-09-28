-- AlterTable
ALTER TABLE "Product" ADD COLUMN "discountPercent" INTEGER NOT NULL DEFAULT 0;

-- Backfill: percentual a partir de price/comparePrice existentes
UPDATE "Product"
SET "discountPercent" = ROUND(((CAST("comparePrice" AS NUMERIC) - CAST("price" AS NUMERIC)) / CAST("comparePrice" AS NUMERIC)) * 100)::INTEGER
WHERE "comparePrice" IS NOT NULL AND CAST("comparePrice" AS NUMERIC) > CAST("price" AS NUMERIC);

-- CreateIndex
CREATE INDEX "Product_discountPercent_idx" ON "Product"("discountPercent");

-- Reversão (manual, se necessário):
-- DROP INDEX "Product_discountPercent_idx";
-- ALTER TABLE "Product" DROP COLUMN "discountPercent";
