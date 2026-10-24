-- Idempotência do CHECKOUT: mesma chave de idempotência = MESMO pedido.
-- O cliente/front envia `Idempotency-Key` estável por tentativa de compra; o
-- índice único transforma o retry (duplo clique, rede instável, HTTP retry do
-- navegador) em P2002, que a rota /api/pedidos devolve como o pedido já
-- existente. Sem isso, cada requisição gerava um pedido — e uma cobrança —
-- novos (diagnóstico: "Order creation without idempotency").
-- NULL permitido: pedidos anteriores ao recurso não têm chave (sem backfill).
ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
