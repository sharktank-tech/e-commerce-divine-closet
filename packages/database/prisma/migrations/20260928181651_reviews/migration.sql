-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDENTE', 'APROVADA', 'REJEITADA');

-- AlterTable (Review vazio em produção: troca da unicidade por pedido)
ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_userId_productId_key";
ALTER TABLE "Review" ADD COLUMN "orderId" UUID,
ADD COLUMN "titulo" TEXT,
ADD COLUMN "tamanhoComprado" TEXT,
ADD COLUMN "caimento" TEXT,
ADD COLUMN "alturaCliente" TEXT,
ADD COLUMN "status" "ReviewStatus" NOT NULL DEFAULT 'PENDENTE',
ADD COLUMN "respostaLoja" TEXT;

-- Backfill: sem linhas existentes; novas avaliações exigem pedido (NOT NULL)
ALTER TABLE "Review" ALTER COLUMN "orderId" SET NOT NULL;
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_productId_key" UNIQUE ("orderId", "productId");
CREATE INDEX "Review_productId_status_idx" ON "Review"("productId", "status");

-- AlterTable Order (rastreio do convite pós-compra)
ALTER TABLE "Order" ADD COLUMN "reviewRequestedAt" TIMESTAMP(3);

-- CreateTable ReviewPhoto
CREATE TABLE "ReviewPhoto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reviewId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewPhoto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReviewPhoto_reviewId_idx" ON "ReviewPhoto"("reviewId");
ALTER TABLE "ReviewPhoto" ADD CONSTRAINT "ReviewPhoto_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: leitura pública só de aprovadas; app (divine_app) total; postgres bypassa
ALTER TABLE "Review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReviewPhoto" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'divine_app') THEN
    EXECUTE 'CREATE POLICY "app total" ON "Review" FOR ALL TO divine_app USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "app total" ON "ReviewPhoto" FOR ALL TO divine_app USING (true) WITH CHECK (true)';
  END IF;
END $$;
CREATE POLICY "leitura publica aprovadas" ON "Review" FOR SELECT TO anon, authenticated USING (status = 'APROVADA');
CREATE POLICY "fotos publicas aprovadas" ON "ReviewPhoto" FOR SELECT TO anon, authenticated USING (
  EXISTS (SELECT 1 FROM "Review" r WHERE r.id = "ReviewPhoto"."reviewId" AND r.status = 'APROVADA')
);

-- Reversão (manual, se necessário): DROP TABLE "ReviewPhoto"; remover colunas/policy/índices acima.
