-- OrderItem -> Product: Restrict impede hard delete de produto com histórico de pedidos.
-- O admin passa a desativar (isActive=false, deletedAt) em vez de apagar a linha.
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_productId_fkey";
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE Restrict ON UPDATE Cascade;
