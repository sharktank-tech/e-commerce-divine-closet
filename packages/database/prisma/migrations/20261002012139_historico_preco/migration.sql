-- Auditoria de preço: uma linha por mudança de Product.price.
CREATE TABLE "historico_preco" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "produto_id" UUID NOT NULL,
  "usuario_id" UUID,
  "preco_anterior_centavos" INTEGER NOT NULL,
  "preco_novo_centavos" INTEGER NOT NULL,
  "origem" TEXT NOT NULL,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "historico_preco_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "historico_preco_produto_id_criado_em_idx" ON "historico_preco"("produto_id", "criado_em");
ALTER TABLE "historico_preco" ADD CONSTRAINT "historico_preco_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "Product"("id") ON DELETE Cascade ON UPDATE Cascade;
ALTER TABLE "historico_preco" ADD CONSTRAINT "historico_preco_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "User"("id") ON DELETE Set Null ON UPDATE Cascade;
