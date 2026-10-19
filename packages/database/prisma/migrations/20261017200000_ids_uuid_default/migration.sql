-- Correção de drift das migrations do ciclo 2026-10-17: Refund, OrderTrackToken
-- e ErpEvent foram criadas como TEXT sem DEFAULT, divergindo do schema
-- (@db.Uuid @default(dbgenerated("gen_random_uuid()"))). O Prisma omite a
-- coluna `id` no INSERT esperando o default do banco → violação NOT NULL.
-- Reproduzido em produção: POST /api/admin/pedidos/{id}/estornar retornava
-- 500 (refund.create) antes de qualquer chamada ao Mercado Pago; reenvio de
-- link de convidado (orderTrackToken.create) teria o mesmo efeito.
-- As três tabelas estão vazias em produção (nenhum insert jamais funcionou);
-- o cast `USING "id"::uuid` é seguro e preserva valores já gerados como uuid.
-- Precedente: 20261012162926_auditlog_id_default.
ALTER TABLE "Refund" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "Refund" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "OrderTrackToken" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "OrderTrackToken" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "ErpEvent" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
ALTER TABLE "ErpEvent" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
