-- Execute apenas em banco PostgreSQL descartável e vazio, com psql -v ON_ERROR_STOP=1.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'divine_app') THEN CREATE ROLE divine_app; END IF;
END $$;

DO $$
DECLARE tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['EmailOutbox','ErpEvent','OrderTrackToken','RateLimit','Refund',
    'SizeTable','SlugRedirect','config_precificacao','historico_preco','materiais_embalagem'] LOOP
    EXECUTE format('CREATE TABLE public.%I (id integer PRIMARY KEY)', tabela);
    EXECUTE format('INSERT INTO public.%I VALUES (1)', tabela);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated', tabela);
  END LOOP;
END $$;
CREATE TABLE public."Product" (id integer PRIMARY KEY);
CREATE TABLE public.lotes_compra (id integer PRIMARY KEY);
INSERT INTO public."Product" VALUES (1);
INSERT INTO public.lotes_compra VALUES (1);
ALTER TABLE public."Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lotes_compra ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public."Product", public.lotes_compra TO authenticated;
CREATE POLICY teste_provisorio_product ON public."Product" FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY teste_provisorio_lotes ON public.lotes_compra FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Representa as policies de avaliações existentes no projeto.
CREATE TABLE public."Review" (id integer, status text);
CREATE TABLE public."ReviewPhoto" (id integer, review_id integer);
INSERT INTO public."Review" VALUES (1, 'APROVADA'), (2, 'PENDENTE');
INSERT INTO public."ReviewPhoto" VALUES (1, 1), (2, 2);
GRANT SELECT ON public."Review", public."ReviewPhoto" TO anon, authenticated;
ALTER TABLE public."Review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ReviewPhoto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_public ON public."Review" FOR SELECT TO anon, authenticated USING (status = 'APROVADA');
CREATE POLICY photo_public ON public."ReviewPhoto" FOR SELECT TO anon, authenticated USING
  (EXISTS (SELECT 1 FROM public."Review" r WHERE r.id = review_id AND r.status = 'APROVADA'));

\ir ../prisma/migrations/20261027130000_seguranca_acesso_tabelas/migration.sql

DO $$
DECLARE tabela text; papel text; permissao text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['EmailOutbox','ErpEvent','OrderTrackToken','RateLimit','Refund',
    'SizeTable','SlugRedirect','config_precificacao','historico_preco','materiais_embalagem'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', tabela)::regclass) THEN
      RAISE EXCEPTION 'RLS desativado em %', tabela;
    END IF;
    FOREACH papel IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH permissao IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(papel, format('public.%I', tabela), permissao) THEN
          RAISE EXCEPTION '% tem % em %', papel, permissao, tabela;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM public."Refund"; RAISE EXCEPTION 'anon leu Refund';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT count(*) FROM public."Review") <> 1 OR (SELECT count(*) FROM public."ReviewPhoto") <> 1 THEN
    RAISE EXCEPTION 'leitura pública de avaliações alterada';
  END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN UPDATE public."ErpEvent" SET id = 3; RAISE EXCEPTION 'authenticated alterou ErpEvent';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public."Product" SET id = 2;
  IF FOUND THEN RAISE EXCEPTION 'authenticated alterou Product'; END IF;
  UPDATE public.lotes_compra SET id = 2;
  IF FOUND THEN RAISE EXCEPTION 'authenticated alterou lotes'; END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE divine_app;
DO $$
DECLARE tabela text; qtd integer;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['EmailOutbox','ErpEvent','OrderTrackToken','RateLimit','Refund',
    'SizeTable','SlugRedirect','config_precificacao','historico_preco','materiais_embalagem'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', tabela) INTO qtd;
    IF qtd <> 1 THEN RAISE EXCEPTION 'app não lê %', tabela; END IF;
    EXECUTE format('INSERT INTO public.%I VALUES (2)', tabela);
    EXECUTE format('UPDATE public.%I SET id = 3 WHERE id = 2', tabela);
    EXECUTE format('DELETE FROM public.%I WHERE id = 3', tabela);
  END LOOP;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'Segurança: RLS, negações, avaliações e CRUD do servidor verificados.'
