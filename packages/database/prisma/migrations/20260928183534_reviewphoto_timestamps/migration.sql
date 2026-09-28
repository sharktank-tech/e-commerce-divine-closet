-- Alinha defaults com o schema (createdAt gerenciado pelo banco)
ALTER TABLE "ReviewPhoto" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Reversão (manual, se necessário):
-- ALTER TABLE "ReviewPhoto" ALTER COLUMN "createdAt" DROP DEFAULT;
