# GA4.2 — Diagnóstico do drift legado Prisma e gate de regressão

**Base do trabalho:** PR #34 (concorrência GA4). **Sem alteração no schema, sem novas migrations, sem acesso ao banco de produção.**

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

O arquivo `scripts/ga4-prisma-legacy-drift.baseline.json` fixa exatamente **32 entradas** distribuídas por **7 tabelas**. A assinatura foi extraída do output daquela execução, preservando ordem e conteúdo do Prisma.

| Tabela | Diferença | Risco de aplicar DDL automaticamente |
| --- | --- | --- |
| `AuditLog` | PK `id` TEXT no histórico; `@db.Uuid` no schema. | **Alto:** cast ou recriação da PK pode perder dados, quebrar FKs, falhar para IDs legados não UUID. A migration `20260928181000_rebuild_legacy_uuid` excluiu `AuditLog` deliberadamente. |
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
4. Exige assinatura **exatamente igual** às 32 diferenças documentadas (7 tabelas), incluindo a mesma ordem.
5. Bloqueia quando houver nova diferença, alteração/redução não revisada, stdout incompreensível ou erro do Prisma (exit diferente de 0 ou 2).
6. Em caso conhecido, passa o gate com aviso explícito: **drift legado continua pendente**, não está resolvido.

O gate é uma **proteção contra regressão**. Não altera o banco, não transforma drift conhecido em aprovado e **não verifica schema real de produção**. Qualquer atualização futura do baseline exige comparar output, justificar cada alteração e revisar explicitamente o PR.

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
