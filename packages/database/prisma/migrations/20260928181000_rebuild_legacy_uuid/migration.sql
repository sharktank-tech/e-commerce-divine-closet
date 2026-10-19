-- Compatibilidade de reconstrução: converte os `id` TEXT das tabelas legadas
-- para UUID (padrão atual do schema) ANTES de 20260928181651_reviews.
--
-- POR QUE ESTA MIGRAÇÃO EXISTE (não reescreve nada já aplicado):
-- As conversões id TEXT→uuid do ciclo ~25–28/09 aconteceram FORA do
-- histórico (db push) e não deixaram migration. Replays puros do histórico
-- em um banco VAZIO falham em 20260928181651_reviews com
--   42804: foreign key "Review_orderId_fkey" cannot be implemented
--           (incompatible types: uuid and text)
-- e, adiante, em 20260929150000_lotes_e_configuracao (categoria_id UUID →
-- Category.id), 20261001233410_orderitem_product_restrict,
-- 20261002003132_cartitem_unitprice (UPDATE ... WHERE productId = id),
-- 20261002012139_historico_preco, 20261017170000_refund e
-- 20261017180000_order_track_token.
--
-- É um NO-OP em bancos já convertidos (produção): se nenhuma `id` da lista
-- está mais em text, a rotina sai antes de tocar em qualquer constraint.
-- AuditLog.id permanece TEXT por decisão documentada (valores legados;
-- ver DRIFT-BANCO-2026-10-17.md e migrations-id-default.test.ts).
--
-- Posição: ordena entre 20260928180013_image_meta e 20260928181651_reviews,
-- exatamente onde a cadeia precisa do tipo uuid.

-- Roles usados pelas policies de 20260928181651_reviews (Supabase já os tem).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'divine_app') THEN
    CREATE ROLE divine_app NOLOGIN;
  END IF;
END $$;

DO $$
DECLARE
  -- tabelas legadas criadas com id TEXT (AuditLog fica de fora, por decisão)
  tabelas CONSTANT TEXT[] := ARRAY[
    'User','Address','Category','Product','ProductVariation','WishlistItem',
    'Cart','CartItem','Order','OrderItem','Review','Coupon','Banner'
  ];
  precisa BOOLEAN;
  -- snapshot das FKs capturado ANTES do drop (defs recriadas no fim)
  defs     TEXT[] := ARRAY[]::TEXT[];
  rel_orig oid[]  := ARRAY[]::oid[];
  col_orig name[] := ARRAY[]::name[];
  rel_alvo oid[]  := ARRAY[]::oid[];
  col_alvo name[] := ARRAY[]::name[];
  fk       RECORD;
  a        pg_attribute%ROWTYPE;
  b        pg_attribute%ROWTYPE;
  i        INTEGER;
  tabela   TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns ic
    WHERE ic.table_schema = 'public'
      AND ic.column_name = 'id'
      AND ic.data_type = 'text'
      AND ic.table_name = ANY (tabelas)
  ) INTO precisa;

  IF NOT precisa THEN
    RAISE NOTICE 'rebuild_legacy_uuid: ids já em uuid — no-op';
    RETURN;
  END IF;

  -- 1) captura TODAS as FKs do schema público e as remove
  FOR fk IN
    SELECT c.conname AS nome,
           c.conrelid AS origem,
           c.confrelid AS destino,
           c.conkey,
           c.confkey,
           pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.connamespace = 'public'::regnamespace
     ORDER BY c.conname
  LOOP
    -- pg_get_constraintdef devolve só "FOREIGN KEY ..." — o ALTER completo é
    -- montado aqui para o replay final.
    defs := defs || format('ALTER TABLE %s ADD CONSTRAINT %I %s',
                           fk.origem::regclass::text, fk.nome, fk.def);
    FOR i IN 1 .. array_length(fk.conkey, 1) LOOP
      SELECT * INTO a FROM pg_attribute
       WHERE attrelid = fk.origem AND attnum = fk.conkey[i];
      SELECT * INTO b FROM pg_attribute
       WHERE attrelid = fk.destino AND attnum = fk.confkey[i];
      rel_orig := rel_orig || fk.origem;
      col_orig := col_orig || a.attname;
      rel_alvo := rel_alvo || fk.destino;
      col_alvo := col_alvo || b.attname;
    END LOOP;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.origem::regclass::text, fk.nome);
  END LOOP;

  -- 2) id text → uuid + default (Prisma omite a coluna em INSERT)
  FOREACH tabela IN ARRAY tabelas LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns ic
      WHERE ic.table_schema = 'public' AND ic.table_name = tabela
        AND ic.column_name = 'id' AND ic.data_type = 'text'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id TYPE uuid USING id::uuid', tabela);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT gen_random_uuid()', tabela);
    END IF;
  END LOOP;

  -- 3) colunas FK que apontavam para id convertido (text → uuid); só converte
  --    quando o alvo já está uuid — FKs para tabelas não convertidas seguem text
  FOR i IN 1 .. coalesce(array_length(rel_orig, 1), 0) LOOP
    IF (SELECT atttypid FROM pg_attribute
         WHERE attrelid = rel_orig[i] AND attname = col_orig[i]) = 'text'::regtype
       AND (SELECT atttypid FROM pg_attribute
         WHERE attrelid = rel_alvo[i] AND attname = col_alvo[i]) = 'uuid'::regtype
    THEN
      EXECUTE format(
        'ALTER TABLE %s ALTER COLUMN %I TYPE uuid USING %I::uuid',
        rel_orig[i]::regclass::text, col_orig[i], col_orig[i]
      );
    END IF;
  END LOOP;

  -- 4) recria as FKs com as defs originais (sem notação de tipo na def)
  FOREACH tabela IN ARRAY defs LOOP
    EXECUTE tabela;
  END LOOP;

  RAISE NOTICE 'rebuild_legacy_uuid: 13 tabelas convertidas; % FKs recriadas',
               coalesce(array_length(defs, 1), 0);
END $$;
