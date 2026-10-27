-- As tabelas operacionais são acessadas pelo servidor, não pela Data API.
-- Revogar privilégios e ativar RLS são camadas independentes de proteção.
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY[
    'EmailOutbox', 'ErpEvent', 'OrderTrackToken', 'RateLimit', 'Refund',
    'SizeTable', 'SlugRedirect', 'config_precificacao', 'historico_preco',
    'materiais_embalagem'
  ] LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', tabela);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabela);
    -- A aplicação pode conectar com a role dedicada, que não ignora RLS.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO divine_app', tabela);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tabela AND policyname = 'divine_app_full'
    ) THEN
      EXECUTE format('CREATE POLICY divine_app_full ON public.%I FOR ALL TO divine_app USING (true) WITH CHECK (true)', tabela);
    END IF;
  END LOOP;
  -- Policies temporárias permitem acesso irrestrito a qualquer sessão autenticada.
  -- Preservar as demais, inclusive as de leitura pública.
  DROP POLICY IF EXISTS teste_provisorio_product ON public."Product";
  DROP POLICY IF EXISTS teste_provisorio_lotes ON public.lotes_compra;
END $$;
