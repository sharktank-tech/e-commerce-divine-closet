# Eventos ERP persistentes (PR de fila ERP)

Estado: branch `feat/erp-evento-persistente` (empilhada sobre
`fix/estorno-email-refunded` — PR #10), deste documento.
Escopo desta rodada: **sem merge, sem deploy, sem entrega de eventos
(webhook ERP nunca disparado aqui).**

## 1. Causa do defeito

`enfileirarEvento` (`apps/web/src/lib/erp.ts`) começava com
`if (!config()) return null` — **sem `ERP_WEBHOOK_URL/SECRET`, nada era
persistido**. Em produção (sem essas variáveis):

- o estorno real do pedido `DC-20261017-7653` (refund `3453063320`,
  17/10) transicionou o pedido para `REFUNDED`, mas o evento
  `pedido_estornado` correspondente **nunca existiu** na fila `ErpEvent`;
- o mesmo valia para `pedido_pago`, `pedido_criado`, `pedido_cancelado`,
  `estoque_atualizado` e eventos de produto — a fila era **zero** em
  produção, não uma fila de entrega pendente;
- um comentário no próprio `erp.ts` documentava esse comportamento como
  intencional ("desativado é o normal"), misturando duas decisões
  distintas:
  - **não entregar** sem endpoint/segredo → decisão correta;
  - **não registrar a ocorrência** → histórico de negócio perdido para
    sempre, irreconciliável.

## 2. Correção (desenho implementado)

**Persistir sempre; entregar só com configuração.**

1. `enfileirarEvento(tipo, dados, {db?, businessKey?})` grava `ErpEvent`
   `PENDING` incondicionalmente (na transação `tx` quando informada).
   Sem `ERP_WEBHOOK_*`, a linha fica guardada — a entrega acontece quando
   a configuração existir (dreno).
2. **`businessKey` única** (`ErpEvent.businessKey String? @unique`,
   migration `20261017220000_erp_event_business_key`):
   `pedido_estornado:{orderId}`, `pedido_pago:{orderId}`,
   `pedido_criado:{orderId}`, `pedido_cancelado:{orderId}`.
   Repetição/concorrência → `P2002` → devolve a linha existente.
   `NULL` continua permitido (eventos livrísticos de estoque/edição).
3. **Transição + evento atômico** (as duas faces do mesmo fato):
   - estorno: `transicionarEstornoComEvento` — `$transaction` com as duas
     guardas `updateMany` (paymentStatus/status) **+**
     `enfileirarEvento(..., {db: tx, businessKey})`; erro → rollback e
     `{mudou:false}` (a reconciliação reprocessa);
   - finalização Pix (`finalizar.ts`): `pedido_pago` +
     `estoque_atualizado` enfileirados **dentro** do `$transaction`,
     entregues fire-and-forget **pós-commit**;
   - criação de pedido (`/api/pedidos`): `pedido_criado` dentro do
     create-tx, entrega pós-commit;
   - cancelamentos (gateway em exceção, recusa de pagamento,
     reconciliação de Pix, admin PATCH): `pedido_cancelado` enfileirado
     na MESMA transação do `updateMany` de cancelamento;
   - admin PATCH: qualquer atualização roda em `$transaction`; ao entrar
     em `CANCELLED` (e só então) grava o evento com businessKey.
4. `notificarErp(tipo, dados)` virou casca: `enfileirarEvento` + entrega
   só se `erpConfigurado()` — assinatura e comportamento externo
   inalterados (rotas de produto continuam chamando como antes).
5. `drenarEventosErp` / `entregarEvento` **não mudaram**: entrega segue
   atrás de `ERP_WEBHOOK_URL/SECRET` e nunca roda sem config.
6. `DbErp` exportado permite aos `fakes` de teste registrarem
   `erpEvent`; transições antigas sem `erpEvent` (não relacionadas ao
   estorno) são toleradas via `tx.erpEvent?`.

## 3. Ativação da integração (após merge/deploy)

1. Configurar no painel Vercel: `ERP_WEBHOOK_URL`, `ERP_WEBHOOK_SECRET`
   (hoje **ausentes** — por isso nenhum evento nunca foi entregue).
2. Com config ativa, o dreno entrega linhas `PENDING` vencidas:
   - cron diário 09h (`/api/cron/carrinho-abandonado` já chama
     `drenarEventosErp`);
   - acionamento manual: rota admin `POST /api/admin/erp` (sessão
     `dc_admin_session`).
3. Sem config: fila **acumula** (o dreno nem consulta) — é o esperado
   até ativação; o histórico fica íntegro.

## 4. Limitações documentadas

- **Vercel Hobby**: cron mínimo 1x/dia por job — retentativa de entrega
  é diária (janela 09h), além das tentativas internas por evento.
- Eventos ficam `PENDING` indefinidamente sem config (fila crescente) —
  sem perda, mas consumindo linhas; avaliar limpeza de eventos antigos
  `DELIVERED` se o volume crescer.
- `ErpEvent` não tem FK para `Order` (mesmo critério de auditoria):
  linhas sobrevivem a remoção hipotética de pedidos.
- `payload` guarda só `dados` (`{numero, total}` etc.); o envelope
  (`event_id`, `versao`, `ocorrido_em`) é montado na entrega a partir de
  `createdAt` da linha.

## 5. Backfill do evento ausente do 7653 — PREPARADO, NÃO EXECUTADO

Script `scripts/backfill-erp-estorno-7653.ts` (dry-run executado, sem
gravação):

```bash
# dry-run (padrão): só lê — imprime resumo e o estado da migration
npx tsx --tsconfig apps/web/tsconfig.json scripts/backfill-erp-estorno-7653.ts

# após autorização + migration aplicada: grava a linha PENDING (NÃO entrega)
npx tsx --tsconfig apps/web/tsconfig.json scripts/backfill-erp-estorno-7653.ts --aplicar
```

- payload idêntico ao produto: `{numero: "DC-20261017-7653", total: 32.99}`;
- `businessKey = pedido_estornado:{orderId}` → idempotente (segunda
  execução reporta a linha existente);
- `createdAt = Refund.resolvedAt` real
  (`2026-10-17T18:34:54.611Z`) → `ocorrido_em` do envelope = horário do
  estorno no provedor, não o do backfill;
- dry-run atual: **migration `businessKey` pendente no alvo** (coluna
  ainda não existe em produção) → `--aplicar` recusa com instrução
  clara até o deploy do PR;
- o script nunca chama entrega — a linha só sai quando houver
  `ERP_WEBHOOK_*` + dreno.

## 6. Validações executadas nesta rodada

- suíte completa: **46 arquivos / 418 testes** ✅ (inclui os novos de
  businessKey/idempotência e as asserções de evento na transição);
- `tsc --noEmit` ✅, `next lint` ✅ (só avisos `<img>` pré-existentes),
  `next build` ✅;
- migration `20261017220000_erp_event_business_key` em PG real
  (PGlite): `prisma migrate diff --script` **antes** propõe exatamente
  `ADD COLUMN "businessKey" TEXT` + `CREATE UNIQUE INDEX
  "ErpEvent_businessKey_key"`; **depois** de aplicar: 0 linhas de
  diff; businessKey duplicada → `23505`; `NULL`s ilimitados; linha
  legada pré-migration intacta;
- backfill 7653: dry-run read-only com dados reais (saída acima).

## 7. Pendências operacionais (não executadas nesta rodada)

1. **Ordem de merge**: PR #9 (drift/migrações) → PR #10 (e-mail
   estorno) → este PR (base = `fix/estorno-email-refunded`).
2. Deploy → `prisma migrate deploy` aplica
   `20261017210000_email_outbox` **e**
   `20261017220000_erp_event_business_key`.
3. Confirmar `EMAIL_DRIVER=resend` + `RESEND_API_KEY` + `CRON_SECRET`
   no Vercel (item do PR #10) e configurar `ERP_WEBHOOK_URL` +
   `ERP_WEBHOOK_SECRET` quando a integração for ativada.
4. Só quando autorizado: `--aplicar` dos dois backfills do 7653
   (e-mail e evento ERP) e acompanhamento do dreno.
