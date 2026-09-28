-- AlterTable
ALTER TABLE "Category" ADD COLUMN "menuOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "showInMenu" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "showInHome" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "image" TEXT;

-- Reversão (manual, se necessário):
-- ALTER TABLE "Category" DROP COLUMN "menuOrder", DROP COLUMN "showInMenu", DROP COLUMN "showInHome", DROP COLUMN "image";
