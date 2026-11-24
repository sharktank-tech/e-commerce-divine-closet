-- Pré-validação de risco do drift legado — SOMENTE LEITURA.
-- Não corrige schema; não expõe IDs, nomes, e-mails ou pagamentos.
-- Executar somente em réplica/clone autorizado, antes de propor DDL.
-- A transação READ ONLY impede gravações acidentais.
BEGIN TRANSACTION READ ONLY;

SELECT 'auditlog_id_non_uuid_rows' AS check_name, COUNT(*)::bigint AS total
  FROM "AuditLog"
 WHERE id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

SELECT 'product_null_cost_rows' AS check_name, COUNT(*)::bigint AS total
  FROM "Product"
 WHERE "custo_peca_centavos" IS NULL
    OR "custo_embalagem_centavos" IS NULL;

SELECT 'product_nonnull_precificacao_date_rows' AS check_name, COUNT(*)::bigint AS total
  FROM "Product"
 WHERE "precificacao_calculada_em" IS NOT NULL;

SELECT 'lotes_duplicate_nome_groups' AS check_name, COUNT(*)::bigint AS total
  FROM (SELECT nome FROM "lotes_compra" GROUP BY nome HAVING COUNT(*) > 1) duplicate_names;

SELECT 'materiais_duplicate_nome_groups' AS check_name, COUNT(*)::bigint AS total
  FROM (SELECT nome FROM "materiais_embalagem" GROUP BY nome HAVING COUNT(*) > 1) duplicate_names;

SELECT 'lotes_nonnull_categoria_rows' AS check_name, COUNT(*)::bigint AS total
  FROM "lotes_compra" WHERE categoria_id IS NOT NULL;

SELECT 'product_nonnull_lote_rows' AS check_name, COUNT(*)::bigint AS total
  FROM "Product" WHERE lote_id IS NOT NULL;

SELECT 'legacy_review_user_product_unique_indexes' AS check_name,
       COUNT(*)::bigint AS total
  FROM pg_indexes
 WHERE schemaname = current_schema()
   AND tablename = 'Review'
   AND indexdef ILIKE '%UNIQUE%'
   AND indexdef LIKE '%"userId"%'
   AND indexdef LIKE '%"productId"%';

SELECT 'marketing_message_fk_constraints' AS check_name,
       COUNT(*)::bigint AS total
  FROM pg_constraint c
 WHERE c.conrelid = '"MarketingMessage"'::regclass
   AND c.contype = 'f';

SELECT 'lotes_timestamp_rows' AS check_name, COUNT(*)::bigint AS total
  FROM "lotes_compra";

SELECT 'materiais_timestamp_rows' AS check_name, COUNT(*)::bigint AS total
  FROM "materiais_embalagem";

SELECT 'config_timestamp_rows' AS check_name, COUNT(*)::bigint AS total
  FROM "config_precificacao";

ROLLBACK;
