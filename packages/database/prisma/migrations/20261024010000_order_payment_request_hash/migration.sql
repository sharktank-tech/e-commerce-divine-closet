-- Só um hash de parâmetros não sensíveis. Nenhum PAN, CVV ou token é persistido.
ALTER TABLE "Order" ADD COLUMN "paymentRequestHash" TEXT;
