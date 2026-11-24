# GA4.2 — Alinhamento não destrutivo dos timestamps legados de precificação

**PR dependente do #36**. Nenhuma migration SQL, DDL, backfill, exclusão ou consulta ao Supabase de produção. O teste usa apenas o PostgreSQL descartável do GitHub Actions.

## Diferenças identificadas

O histórico `20260929150000_lotes_e_configuracao/migration.sql` criou:

- `config_precificacao.created_at` e `config_precificacao.updated_at`;
- `materiais_embalagem.created_at` e `materiais_embalagem.updated_at`.

Nas duas tabelas, as quatro colunas físicas são `TIMESTAMPTZ NOT NULL DEFAULT now()`. No Prisma, porém, eram `DateTime` sem `@db.Timestamptz(6)`, com `@updatedAt` sem `@default(now())` nas colunas de atualização. Isso gerava cinco diferenças **de timestamps/defaults** (uma linha de tabela e duas diferenças em `config_precificacao`; duas alterações de coluna em `materiais_embalagem`, cuja linha de tabela persiste por uma divergência adicional de índice UNIQUE).

## Mudança proposta

Alinhar **somente o modelo Prisma** às colunas existentes:

```prisma
created_at DateTime @default(now()) @db.Timestamptz(6)
updated_at DateTime @default(now()) @updatedAt @db.Timestamptz(6)
```

`@updatedAt` é preservado para manter atualizações de timestamp pelo Prisma Client. O default de banco é explicitado no modelo; `@db.Timestamptz(6)` espelha o tipo e precisão PostgreSQL. **Não convertê-lo para `TIMESTAMP`**, pois isso poderia alterar a semântica de fuso/instante.

O diff real do PostgreSQL descartável mostrou redução do baseline de **6 tabelas/28 entradas para 5 tabelas/23 entradas**. A tabela `materiais_embalagem` permanece porque ainda falta o índice `UNIQUE(nome)`; criar esse índice sem verificar duplicações reais seria imprudente. O guard deve continuar bloqueando qualquer divergência além das cinco tabelas e 23 entradas identificadas.

## Gates

- Prisma schema validate e replay de migrations em PostgreSQL local descartável.
- Guard de drift bloqueia qualquer diferença inesperada; nenhuma `continue-on-error`.
- Teste real do catálogo do banco via `information_schema.columns` confirma tipos e defaults das quatro colunas.
- Leitura do Prisma Client valida `Date` sem modificar configuração ou materiais.
- Suíte completa, TypeScript, lint e build.
- Nenhuma alteração no transporte de eventos GA4 refund (continua hard-off).

## Ainda não resolvido

Cinco tabelas permanecem no baseline:

1. `MarketingMessage`: ações de exclusão das chaves estrangeiras.
2. `Product`: FK de lote, nulidade de custos, default de descrição e timestamp de precificação.
3. `Review`: unicidade legada por usuário/produto.
4. `lotes_compra`: FK e índices, default de quantidade, timestamps, unicidade por nome.\n5. `materiais_embalagem`: índice `UNIQUE(nome)` ausente no histórico, exige pré-validação de duplicatas antes de criar DDL.

**Atenção:** o comportamento físico do banco de produção não foi validado. Branching do Supabase não está disponível no plano atual; testes descartáveis verificam o replay do histórico, não dados legados reais. Antes de qualquer integração/DDL em produção, serão necessários clone autorizado, contagens de risco e plano de migração revisado. Não usar `prisma db push` nem DDL automático para eliminar o drift.

**PR permanece em DRAFT e depende da cadeia #26 → #32 → #33 → #34 → #35 → #36.**
