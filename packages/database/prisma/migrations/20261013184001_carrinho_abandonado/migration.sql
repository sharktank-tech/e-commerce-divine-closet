-- Lembrete de carrinho abandonado: marca + idade dos itens.
ALTER TABLE "Cart" ADD COLUMN "lembradoEm" TIMESTAMP(3);
ALTER TABLE "CartItem" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
