-- Retenção operacional de pedido pago sem estoque + reserva de cupom na
-- criação (diagnóstico PR #16 — lacunas da revisão de integridade).
--
-- 1) holdCode/holdReason/holdAt: o pagamento foi APROVADO no provedor, mas a
--    finalização não conseguiu baixar estoque (corrida, divergência de saldo).
--    Antes isso virava `throw` → o webhook devolvia 500 → o Mercado Pago
--    reenviava a notificação para sempre e a aprovação financeira ficava sem
--    registro local nenhum (pedido PENDING invisível para o admin). Agora a
--    aprovação é GRAVADA (paymentStatus=PAID) e o pedido entra em retenção:
--    status continua PENDING (não fatura/envia) e o admin enxerga o bloqueio.
--    A coluna é TEXT simples (código de negócio, ex.: ESTOQUE_INSUFICIENTE).
--
-- 2) couponReserved: a contagem de uso do cupom passa a ser RESERVADA na
--    CRIAÇÃO do pedido, dentro da mesma transação, por UPDATE condicional
--    (`usedCount < maxUses`) — o desconto não passa mais do limite comercial
--    só porque a baixa do cupom acontecia na finalização, depois da cobrança.
--    O decremento (liberação) só ocorre em recusa/expiração definitiva.
--    DEFAULT false = pedidos anteriores à migração: a finalização deles
--    continua incrementando como antes (sem backfill de contador).

ALTER TABLE "Order" ADD COLUMN "holdCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "holdReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "holdAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "couponReserved" BOOLEAN NOT NULL DEFAULT false;
