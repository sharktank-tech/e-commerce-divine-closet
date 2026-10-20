# Drift de banco — causa, correção e divergências (2026-10-17)

Auditoria comparando **schema declarado** (`packages/database/prisma/schema.prisma`),
**migrações versionadas** (`packages/database/prisma/migrations/`) e **estrutura efetiva
da produção** (consultas somente-leitura a `information_schema`/`pg_catalog` +
`prisma migrate diff --from-url … --to-schema-datamodel`). Nenhuma migração já aplicada
foi reescrita.

## 1. Defeito do estorno (PR #9) — causa raiz

### O que é geração de id no Prisma (a distinção central)

| Declaração no schema | Quem gera o `id` no INSERT | Risco se o banco não tiver DEFAULT |
| --- | --- | --- |
| `@default(uuid())` / `@default(cuid())` / `@default(now())` | **cliente** (ORM envia o valor) | nenhum |
| `@default(dbgenerated("gen_random_uuid()"))` | **banco** (ORM **omite** a coluna no INSERT) | violação NOT NULL (`23502` → Prisma `P2011`) |

`Refund` e `OrderTrackToken` declaram `@id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` —
ou seja, o ORM **não** gera o id: ele depende do `DEFAULT` da coluna.

### O caminho que falhou

1. As migrações `20261017170000_refund`, `20261017180000_order_track_token` e
   `20261017190000_erp_event` foram **escritas à mão** no SQL do estilo antigo do projeto
   (`"id" TEXT NOT NULL`, sem `DEFAULT`) — nunca foram produzidas por
   `prisma migrate dev` (comprovação: `prisma migrate diff --from-empty
   --to-schema-datamodel` gera `"id" UUID NOT NULL DEFAULT gen_random_uuid()` para as duas).
2. Em produção, `POST /api/admin/pedidos/{id}/estornar` → `refund.create` **omite** `id`
   → `Null constraint violation on the fields: (id)` → HTTP 500 **antes** de qualquer
   chamada ao Mercado Pago (sem efeito financeiro; confirmado `refunds=[]` no provedor).
3. Latente: `orderTrackToken.create` (link de convidado) quebraria do mesmo jeito.
4. `ErpEvent` é o contra-exemplo: o schema **não** declara default no `id` e a aplicação
   **envia** `randomUUID()` — nunca falhou, mas a coluna ficou `TEXT` (drift de tipo vs.
   `@db.Uuid`).

### Outras tabelas com o mesmo problema

Audit integral de todas as colunas `id` em produção (24 tabelas):

- `Refund`, `OrderTrackToken`, `ErpEvent` → **corrigidas** por
  `20261017200000_ids_uuid_default` (`uuid` + `DEFAULT gen_random_uuid()`).
- Todas as demais → `uuid` + `DEFAULT gen_random_uuid()` (conversões feitas **fora** do
  histórico — ver §3), **exceto `AuditLog`**: continua `TEXT` (com `DEFAULT` que gera
  uuid — portanto `insert` funciona, mas o tipo diverge do `@db.Uuid` do schema).
  Divergência conhecida, registrada em §4; não é a causa de falha de `NOT NULL`.
- Nenhuma tabela recente (`carrinho_abandonado` = ALTERs em `Cart`/`CartItem`,
  `order_tracking_carrier` = ALTERs em `Order`) apresenta o defeito.

## 2. Correção aplicada (sem reescrever nada aplicado)

- **Nova migração** `20261017200000_ids_uuid_default` (arquivo novo, não altera histórico):
  `ALTER COLUMN "id" TYPE UUID USING "id"::uuid` + `SET DEFAULT gen_random_uuid()`
  nas três tabelas (todas vazias na data; precedente de estilo:
  `20261012162926_auditlog_id_default`).
- **Registro**: linha em `_prisma_migrations` com `applied_steps_count = 1`,
  `finished_at = 2026-10-17 18:33:51 UTC` e checksum igual ao arquivo local
  (`5f1aa012…`) — aplicada por `prisma migrate deploy` legítimo, não por insert manual.
- **Alinhamento de schema** neste PR: `ErpEvent.id` passa a declarar
  `@default(dbgenerated("gen_random_uuid()"))` (a migration aplicada já cria o default;
  sem isto, `prisma migrate diff` pedia `DROP DEFAULT`).
- **Testes de regressão**:
  - `migrations-id-default.test.ts` — estado final do `id` a partir do histórico, incluindo a
    conversão versionada (23 models; só `AuditLog` segue TEXT);
  - `integration-postgres.test.ts` — **PostgreSQL real** (PGlite servido por socket TCP):
    aplica o SQL versionado defetuoso, **reproduz** `P2011` em
    `refund.create`/`orderTrackToken.create` sem id, aplica a migração de fix e
    reexecuta com sucesso (id gerado no banco); e roda `prisma migrate deploy` em banco
    vazio exigindo o **replay integral** do histórico (todas as migrations, incluindo
    `20260928181000_rebuild_legacy_uuid`) + estrutura final `uuid` +
    `DEFAULT gen_random_uuid()` + unicidades/FKs.

## 3. Por que o histórico não reconstitui produção

A produção **não** foi construída executando o histórico de migrações do zero:

- `init` cria `Order`/`User`/… como `TEXT`; **nada no histórico original converte esses ids
  para `uuid`** — mas produção tem `uuid`. As conversões ocorreram **fora do histórico**
  (época de `db push`/ajustes manuais, ~25–28/09).
- Resultado original: `prisma migrate deploy` em **banco vazio** aplicava até
  `20260928181651_reviews` e **falhava** com `42804` (`Review_orderId_fkey`:
  `uuid` → `Order.id text`).
- **Correção versionada neste PR**: `20260928181000_rebuild_legacy_uuid` replica, dentro do
  histórico, exatamente a conversão que produção recebeu fora dele (13 tabelas:
  `User`, `Address`, `Category`, `Product`, `ProductVariation`, `WishlistItem`, `Cart`,
  `CartItem`, `Order`, `OrderItem`, `Review`, `Coupon`, `Banner` → `id uuid` +
  `DEFAULT gen_random_uuid()`, recriando as FKs afetadas e criando as roles
  `anon`/`authenticated` se ausentes). É **no-op** em produção (nenhuma dessas tabelas tem
  mais `id` text) e **não reescreve** migrações já aplicadas: entra como migração nova
  antes de `reviews`. Em banco vazio o replay agora vai até o fim (verificado por
  `integration-postgres.test.ts` e por reconstrução manual fora do teste).
- 6 linhas de `_prisma_migrations` têm checksums-placeholder (`manual-*`):
  `lotes_e_configuracao`, `orderitem_product_restrict`, `cartitem_unitprice`,
  `historico_preco`, `auditlog_id_default`, `carrinho_abandonado` — SQL aplicado à mão e
  rastreado por insert manual (não editáveis sem reescrever histórico; preservados).
- `prisma migrate status` reporta «up to date» mesmo assim: ele só confere
  **presença** das linhas, **não** a estrutura (por isso o defeito do §1 passou despercebido).

Consequência prática: `ids_uuid_default` em si é executável em qualquer banco que já tenha
as três tabelas (conteúdo idempotente, ordem-independente; provado em integração e
registrado na produção), e a **cadeia completa** agora também roda em banco vazio
(replay integral do histórico, incluindo a migração de compatibilidade do §3).

## 4. Diferenças restantes entre código e produção

`prisma migrate diff --from-url <produção> --to-schema-datamodel schema.prisma`
(leitura). Itens **não executados** nesta rodada — nenhum DDL foi aplicado em produção
além da `ids_uuid_default` já autorizada/aplicada. A classificação abaixo cobre as
**48 linhas** de `diff-combined-vs-schema.txt` (reconstrução combinada vs schema).
Todas são **pré-existentes** (nenhuma vem dos PRs #9/#10/#11 — o
`diff-prod-vs-combined.txt` confirma que os 3 PRs só **adicionam** EmailOutbox/enum,
`ErpEvent.businessKey`+unique e RateLimit, nunca removem objeto de produção).
A rota de implantação é `migrate deploy` (aditiva) — **não** `db push` (sincroniza);
portanto nenhum destes itens dispara na publicação. Classificação:

| Objeto | Diferença (reconstrução → schema) | Origem | Impacto | Ação |
| --- | --- | --- | --- | --- |
| `Product_lote_id_fkey` | reconstrução tem FK `Product.lote_id→lotes_compra`; schema não declara `@relation` | migração criou FK; schema nunca modelou `lote` | nenhum em `migrate deploy`; `migrate dev` futuro geraria DROP FK | alinhar schema (adicionar `@relation`) antes de qualquer `migrate dev`; fora do escopo dos PRs |
| `lotes_compra_categoria_id_fkey` | idem (`categoria_id→Category`) | idem | idem | idem |
| `Review_userId_productId_key` | reconstrução tem unique `[userId,productId]`; schema declara só `[userId,productId,orderId]` | unique legado; schema evoluiu p/ incluir `orderId` | nenhum em deploy; `migrate dev` geraria DROP INDEX | decidir se o unique legado é preservado; pendência documentada |
| `lotes_compra_categoria_id_idx`, `lotes_compra_data_compra_idx` | índices existem na reconstrução; schema não declara `@@index` | migração criou índices; schema os omitiu | nenhum (índice extra não quebra) | opcional: declarar `@@index` no schema |
| `AuditLog.id` | reconstrução `TEXT`+default; schema `UUID DEFAULT gen_random_uuid()` | migração `auditlog_id_default` só adicionou DEFAULT a coluna TEXT (não converteu tipo) | funciona (default gera uuid como texto); tipo diverge | migração futura `TYPE UUID USING id::uuid` (tabela pequena); pendência §6 |
| `Product.custo_peca_centavos`, `custo_embalagem_centavos` | reconstrução `NULL`+`DEFAULT 0`; schema `NOT NULL` | migração de precificação nunca aplicada com o tipo do schema | Prisma client já exige o campo (validação app); nenhum em deploy | pendência: migração de higiene NOT NULL |
| `Product.custos_extras_descricao` | reconstrução `DEFAULT ''`; schema sem default | idem | nenhum | idem |
| `Product.precificacao_calculada_em`, `config_precificacao/lotes_compra/materiais_embalagem.created_at/updated_at` | reconstrução `TIMESTAMPTZ` (+`DEFAULT now()` em `updated_at`); schema `TIMESTAMP(3)` (sem default) | migrações manuais no estilo `TIMESTAMPTZ`; arquivos versionados espelham o banco, o schema diverge | nenhum (ambos armazenam tempo; `TIMESTAMPTZ` é mais correto) | pendência: alinhar schema a `@db.Timestamptz` ou migrar tipos |
| `lotes_compra.quantidade_pecas` | reconstrução sem DEFAULT; schema `DEFAULT 1` | mesma origem (manual) | nenhum | pendência |
| `lotes_compra_nome_key`, `materiais_embalagem_nome_key` | schema declara `nome @unique`; reconstrução **não** tem o índice | unicidade só no schema (migração nunca criou o índice) | inserts duplicados só dependem do app hoje; `migrate dev` geraria CREATE UNIQUE (falharia se houver duplicatas) | pendência: `CREATE UNIQUE INDEX` após verificar duplicatas |

Recomendação de ordem (futura, com aprovação): (1) alinhar `@relation`/únicos do schema ao
desejado **antes** de qualquer `migrate dev`; (2) migração única de higiene (`AuditLog`
uuid, tipos `TIMESTAMP(3)`/defaults, `custo_* NOT NULL`, índices únicos de `nome`);
(3) revisar baseline do histórico (§6). **Nada disto bloqueia a publicação dos PRs** —
a rota é `migrate deploy`, e todos os itens são pré-existentes e aditivos.

## 5. Garantias validadas nesta rodada

- **Produção (somente leitura)**: registro da migração em `_prisma_migrations`
  (checksum confere); tipos/defaults reais das colunas `id`; diff estrutural completo.
- **PostgreSQL real (ambiente isolado, teste automatizado)**: reprodução do `P2011` no
  caminho exato do bug + sucesso após a migração de fix; estrutura final
  `uuid` + `gen_random_uuid()`; `migrate deploy` em **banco vazio** com replay
  **integral** do histórico (inclui `20260928181000_rebuild_legacy_uuid`), sem 42804.
- **Reconstrução/upgrade em PostgreSQL REAL 17.11** (fora do PGlite; servidor dedicado
  porta 5433, bancos `dc_pgreal_*` descartáveis; script versionado em
  `packages/database/scripts/upgrade-pg-real.mjs`):
  - `rebuild` — 28 migrações em banco vazio; inserts ORM **sem id** em
    `Refund`/`OrderTrackToken`/`ErpEvent`/`EmailOutbox`/`RateLimit` todos `ok` (caminho
    que falhou em produção); unicidades `businessKey`/`dedupeKey`/`orderId`/`idempotencyKey`
    bloqueiam a 2ª linha.
  - `prodlike` — base sintética como produção (histórico até `20261017200000`, uuid já
    convertido, dados + Refund/OrderTrackToken/ErpEvent pré-existentes); deploy aplica as
    **4 pendentes** (`rebuild_legacy_uuid` como no-op + `email_outbox` +
    `erp_event_business_key` + `rate_limit`); **dados preservados** (2 users/2 orders/
    1 review/1 cartItem/1 orderItem/1 refund/1 token/2 erpEvents intactos); tabelas novas
    presentes; conflitos de duplicidade bloqueados.
  - `legacy` — base legada (ids ainda TEXT, até `20260928180013`); deploy aplica as
    **20 pendentes** incluindo a conversão TEXT→uuid (`rebuild_legacy_uuid`) com dados
    pré-existentes preservados e conversão aplicada; tabelas novas presentes.
- **Reconstrução manual do zero** (fora do vitest): mesmo replay + auditoria de
  `information_schema` (13 tabelas legadas convertidas; roles; FKs recriadas) e teste de
  upgrade de base pré-pendências com dados e tentativas de duplicidade (bloqueadas).
- **Testes automatizados**: `migrations-id-default.test.ts` (23 models);
  `concorrencia-erp.test.ts` (corrida real em PostgreSQL 17.11) + suíte completa.

## 6. Pendências / ações operacionais

1. **PR #9** (correção + testes + este documento) → merge + `npm run prisma:deploy`
   (a migração já está aplicada; deploy pós-merge só confirma o registro versionado).
2. Decisões sobre divergências do §4 (nenhuma aplicada; não inventar destino/segredo).
3. **Banco novo**: provisionar via `prisma migrate deploy` em banco vazio — o replay
   integral do histórico agora **completa sem falha** (inclui
   `20260928181000_rebuild_legacy_uuid`, provado em PostgreSQL real, modo `rebuild`).
4. `AuditLog.id` → migração futura `TYPE UUID` (ver §4).
