-- Criação da tabela lotes_compra
-- Ajuste de sequence se o seu banco exigir; o padrão PostgreSQL usa SERIAL/bigserial.

-- =====================================================
-- TABLE: lotes_compra
-- =====================================================
CREATE TABLE IF NOT EXISTS "lotes_compra" (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             TEXT NOT NULL,
  data_compra      DATE NOT NULL,
  valor_mercadoria_centavos INTEGER NOT NULL DEFAULT 0,
  valor_frete_centavos      INTEGER NOT NULL DEFAULT 0,
  quantidade_pecas          INTEGER NOT NULL CHECK (quantidade_pecas > 0),
  categoria_id              UUID NULL REFERENCES "Category"(id),
  observacoes               TEXT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices úteis
CREATE INDEX IF NOT EXISTS "lotes_compra_categoria_id_idx" ON "lotes_compra" (categoria_id);
CREATE INDEX IF NOT EXISTS "lotes_compra_data_compra_idx" ON "lotes_compra" (data_compra DESC);

-- Reversão (manual, se necessário):
-- DROP INDEX IF EXISTS "lotes_compra_categoria_id_idx";
-- DROP INDEX IF EXISTS "lotes_compra_data_compra_idx";
-- DROP TABLE IF EXISTS "lotes_compra";

-- =====================================================
-- TABLE: config_precificacao
-- =====================================================
CREATE TABLE IF NOT EXISTS "config_precificacao" (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  markup_padrao_percentual    INTEGER NOT NULL DEFAULT 100,
  regra_arredondamento_custo  TEXT NOT NULL DEFAULT 'inteiro_para_cima',  -- nenhum, inteiro_mais_proximo, inteiro_para_cima, multiplo_de_X
  regra_final_preco           TEXT NOT NULL DEFAULT 'termina_99',       -- termina_99, nenhuma
  rateio_frete                TEXT NOT NULL DEFAULT 'igual',            -- igual, proporcional_ao_custo
  embalagem_entra_no_markup   BOOLEAN NOT NULL DEFAULT true,
  margem_minima_percentual    INTEGER NULL,                           -- null = sem limite
  taxa_pagamento_percentual   INTEGER NULL,                           -- null = sem taxa
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Linha única de configuração — upsert por chave 'default'
INSERT INTO "config_precificacao" (id, markup_padrao_percentual, regra_arredondamento_custo, regra_final_preco, rateio_frete, embalagem_entra_no_markup, margem_minima_percentual, taxa_pagamento_percentual)
VALUES ('00000000-0000-0000-0000-000000000001', 100, 'inteiro_para_cima', 'termina_99', 'igual', true, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- Reversão (manual, se necessário):
-- DROP TABLE IF EXISTS "config_precificacao";

-- =====================================================
-- TABLE: materiais_embalagem
-- =====================================================
CREATE TABLE IF NOT EXISTS "materiais_embalagem" (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  custo_unitario_centavos INTEGER NOT NULL DEFAULT 0,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  ordem       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Materiais iniciais (custo = 0, para a vendedora preencher depois)
INSERT INTO "materiais_embalagem" (id, nome, custo_unitario_centavos, ativo, ordem) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Sacola', 0, true, 1),
  ('00000000-0000-0000-0000-000000000002', 'Papel de embrulho', 0, true, 2),
  ('00000000-0000-0000-0000-000000000003', 'Tag', 0, true, 3),
  ('00000000-0000-0000-0000-000000000004', 'Cartão de agradecimento', 0, true, 4)
ON CONFLICT (id) DO NOTHING;

-- Reversão (manual, se necessário):
-- DROP TABLE IF EXISTS "materiais_embalagem";

-- =====================================================
-- ALTER TABLE: produtos (novos campos opcionais)
-- =====================================================
-- Adicionamos campos novos que são opcionais (null por padrão),
-- para não quebrarem produtos existentes que já estão no ar.

-- lote associado (FK para lotes_compra)
-- Se o produto vier de um lote de compra, esse campo será preenchido.
ALTER TABLE "Product" ADD COLUMN "lote_id" UUID NULL REFERENCES "lotes_compra"(id);

-- Custo unitário da peça (snapshot calculado). Em centavos, inteiro.
ALTER TABLE "Product" ADD COLUMN "custo_peca_centavos" INTEGER NULL DEFAULT 0;

-- Custo de embalagem por peça (snapshot no momento do cálculo).
ALTER TABLE "Product" ADD COLUMN "custo_embalagem_centavos" INTEGER NULL DEFAULT 0;

-- Custos extras do produto (ex.: personalização, gravura) em centavos.
ALTER TABLE "Product" ADD COLUMN "custos_extras_centavos" INTEGER NOT NULL DEFAULT 0;

-- Descrição dos custos extras (para o admin visualizar).
ALTER TABLE "Product" ADD COLUMN "custos_extras_descricao" TEXT NULL DEFAULT '';

-- Markup percentual aplicado a este produto (override do padrão 100%).
-- null = usa o valor da config_precificacao.
ALTER TABLE "Product" ADD COLUMN "markup_percentual" INTEGER NULL DEFAULT NULL;

-- Preço sugerido pelo sistema (snapshot). O admin pode alterar livremente.
ALTER TABLE "Product" ADD COLUMN "preco_sugerido_centavos" INTEGER NULL DEFAULT NULL;

-- Timestamp de quando a precificação foi calculada pela última vez.
ALTER TABLE "Product" ADD COLUMN "precificacao_calculada_em" TIMESTAMPTZ NULL DEFAULT NULL;

-- Comentário: todos os campos acima são opcionais (null) para não afetar produtos existentes.
-- Os snapshots (custo_peca_centavos, custo_embalagem_centavos, preco_sugerido_centavos)
-- são preenchidos quando o admin usa o bloco de precificação no formulário.