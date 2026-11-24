# GA4.2 — Diagnóstico do drift legado Prisma e gate de regressão

**Histórico:** este documento foi criado no PR #35. O PR dependente #36 alinhou **somente o modelo Prisma de `AuditLog.id` como TEXT**, sem DDL/migrations nem acesso ao banco de produção. Todos os itens restantes exigem pré-validação antes de migração.

## 1. Evidência observada

Após `prisma migrate deploy` terminar com sucesso **em PostgreSQL 16 descartável** no GitHub Actions, o comando:

```bash
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel packages/database/prisma/schema.prisma \
  --exit-code
```

encerrou com **status 2**, sinalizando diferenças reais entre o schema efetivo das migrations e o modelo Prisma.

Evidência: [run 45437598704](https://github.com/sharktank-tech/e-commerce-divine-closet/actions/runs/45437598704), job `validate`, etapa de drift. Trata-se de uma **reconstrução vazia da cadeia de migrations**, **não** de uma inspeção do banco real em produção. Não extrapolar contagens ou conteúdo de linhas de produção a partir deste diagnóstico.

### Assinatura do drift

O diagnóstico original do PR #35 apresentou **32 entradas em 7 tabelas**. Com o alinhamento sem DDL de `AuditLog.id` no PR #36, o baseline do arquivo `scripts/ga4-prisma-legacy-drift.baseline.json` passou a registrar **28 entradas em 6 tabelas**. A execução original permanece como evidência histórica. A nova assinatura precisa ser confirmada pelo CI da HEAD do #36.

| Tabela | Diferença | Risco de aplicar DDL automaticamente |
| --- | --- | --- |
| `AuditLog` | **Alinhamento somente no modelo** no PR #36: `id` agora é `String` sem `@db.Uuid`, preservando TEXT no histórico. | Nenhuma conversão de dados/PK foi feita. Confirmar o tipo no clone autorizado antes de integrar a mudança; se o ambiente real diferir, bloquear merge. |
| `MarketingMessage` | Ações das FKs `campaignId` e `subscriberId` divergem. | **Médio:** troca de `ON DELETE` altera invariantes e comportamento do marketing. |
| `Product` | `lote_id` FK; dois custos declarados `NOT NULL` no Prisma mas criados nullable no SQL; default de texto; tipo de timestamp de precificação. | **Alto:** NULLs históricos e timezone precisam de auditoria; possível impacto no cadastro e precificação. |
| `Review` | O banco contém índice único legado `userId, productId` ausente no modelo atual. | **Médio:** removê-lo amplia a possibilidade de avaliações e pode mudar a regra antifraude. |
| `config_precificacao` | `TIMESTAMPTZ` histórico vs `DateTime` padrão Prisma; default de `updated_at`. | **Médio/alto:** conversão de fuso e política de timestamps não podem ser presumidas. |
| `lotes_compra` | FK de categoria; índices; default de quantidade; unicidade de `nome`; campos timestamp. | **Alto:** duplicidade, dependência entre categorias e lotes, índices usados nas consultas. |
| `materiais_embalagem` | Unicidade de `nome`; campos timestamp e defaults. | **Médio/alto:** duplicatas existentes podem impedir criação de UNIQUE. |

O aviso `prisma migrate diff` com exit 2 não significa que as migrations falharam; significa que **o resultado aplicado diverge do schema esperado**. O fato de `migrate deploy` ser verde **não autoriza aplicar a sugestão de SQL gerada automaticamente**.

## 2. Proteção nova no CI

Antes, o passo tinha `continue-on-error: true`, de modo que qualquer diferença nova ou falha inesperada no diagnóstico não bloqueava o workflow.

Agora o workflow:
1. Aplica migrations **somente** ao PostgreSQL descartável designado `divine_ga4_test`.
2. Executa testes Node do guard (`node --test scripts/ga4-prisma-drift-guard.test.mjs`).
3. Captura saída e **exit code real** de `prisma migrate diff` após o migrate.
4. Exige assinatura **exatamente igual** ao baseline vigente (28 diferenças em 6 tabelas após PR #36), incluindo a mesma ordem.
5. Bloqueia quando houver nova diferença, alteração/redução não revisada, stdout incompreensível ou erro do Prisma (exit diferente de 0 ou 2).
6. Em caso conhecido, passa o gate com aviso explícito: **drift legado continua pendente**, não está resolvido.

O baseline original era 7/32 antes da alteração de modelo do #36. O gate é uma **proteção contra regressão**. Não altera o banco, não transforma drift conhecido em aprovado e **não verifica schema real de produção**. Qualquer atualização futura do baseline exige comparar output, justificar cada alteração e revisar explicitamente o PR.

## 3. Pré-validação segura de dados

`scripts/ga4-prisma-drift-preflight.sql` é uma transação PostgreSQL **READ ONLY** que retorna apenas contagens agregadas, sem exibir e-mails, nomes, identificadores, custos individuais ou conteúdo financeiro:

- IDs de `AuditLog` que não seguem UUID.
- Produtos com custo `NULL` e produtos com precificação datada.
- Duplicidade de nomes em lotes e materiais.
- Vínculos `lote_id` e `categoria_id` não nulos.
- Existência de índice único legado em `Review` e FKs de `MarketingMessage`.
- Quantidades de registros que exigem atenção especial ao converter timestamps.

Execução **exclusivamente em clone autorizado** e após revisão de acesso (exemplo ilustrativo):

```bash
psql "$DATABASE_URL_CLONE_AUTORIZADO" -v ON_ERROR_STOP=1 \
  -f scripts/ga4-prisma-drift-preflight.sql
```

**Não rodar contra produção sem autorização e procedimento operacional específico.** Mesmo uma consulta somente leitura pode gerar carga; em bancos grandes, usar réplica, janela controlada e timeout.

## 4. Plano de correção por fases (não implementado)

1. **Escolher a fonte de verdade** entre o comportamento atual do banco, as regras de negócio e o schema Prisma, uma tabela por vez. `AuditLog` exige decisão explícita sobre TEXT vs UUID; não presumir cast.
2. **Inventariar dados reais numa cópia aprovada**, confirmar o volume das anomalias, FKs e índices utilizados, além de contratos de leitura/escrita.
3. **Propor migrations novas e incrementais**, nunca reescrever migrations antigas já aplicadas. Para `UNIQUE`, validar duplicatas e discutir tratamento; para `NOT NULL`, corrigir/backfill histórico com aprovação; para timestamps, decidir fuso e preservar instante; para FKs, revisar `ON DELETE` e operações do admin/marketing.
4. **Reexecutar migração de um clone equivalente à produção**, mais replay do zero em PostgreSQL descartável. Testar backup e rollback, evitar locks longos e qualificar mudanças potencialmente destrutivas.
5. **Verificar drift novamente**, atualizar o baseline **apenas com justificativa revisada** ou removê-lo quando nenhuma diferença restar. Só então substituir o aviso por exigência `exit code = 0`.
6. **Revalidar módulos financeiros/precificação/reviews/marketing**; verificar as políticas RLS separadamente. O diff Prisma não detecta todas as divergências de RLS.

## 5. Relação com GA4.2

A divergência de schema **precede a fundação GA4.2**; não atribuir automaticamente suas sete tabelas ao refund. Contudo, não aprovar a cadeia dos PRs #26, #32, #33 e #34 para produção sem resolver a compatibilidade do histórico com o banco-alvo e o plano de migrations.

Permanecem bloqueados: ativação do transporte externo de refund (hard-off), consentimento guest sem cookie, revogação e entrega em dispositivos/instâncias distintas, política de retenção LGPD e reconciliação histórica de `purchase.value` e `refund.value`.

**Nenhuma alteração destrutiva, DDL em produção, backfill, merge, envio GA4 ou estorno financeiro é autorizada por este documento.**


## 6. Registro da correção não destrutiva do AuditLog (PR #36)

A migração `20260928181000_rebuild_legacy_uuid` preserva `AuditLog.id` em TEXT intencionalmente. O schema Prisma anterior declarava `@db.Uuid`, e o diff sugeria derrubar/recriar a PK, operação inadequada sem verificar os IDs legados. A proposta do #36 **remove apenas `@db.Uuid` do modelo Prisma**, mantendo `@default(dbgenerated("gen_random_uuid()"))`. Não altera migrations nem registros. O CI checa:

- Tipo físico de `AuditLog.id` = TEXT e default `gen_random_uuid()` após replay vazio das migrations.
- Inserção, consulta e remoção de um registro fictício em banco descartável via Prisma Client.
- Remoção das quatro linhas associadas a `AuditLog` no diff, diminuindo o baseline de 7/32 para 6/28.

**Importante:** não havia branch/clone Supabase de desenvolvimento disponível quando este incremento começou. Portanto, não foi verificado se o banco de produção tem o mesmo tipo físico. **Não integrar na main nem aplicar em produção sem pré-validação em clone autorizado**, especialmente porque diferenças reais podem existir fora das migrations versionadas. O transporte externo GA4 permanece hard-off.
