# Runbook de publicação — PRs #9, #10, #11 (DC-20261017-7653)

> Revisão integrada de 17/10/2026. Base combinada validada: branch
> `feat/dc7653-combinado` (worktree `/home/opencode/projects/wt-all`).
> Comandos reproduzíveis: ver "Validações locais" ao final.
> **Nenhum passo abaixo foi executado em produção** — é o roteiro para o
> operador humano/CI.

## 1. O que cada PR entrega

| PR | Branch | Conteúdo | Migrações |
|----|--------|----------|-----------|
| #9 | `fix/migrations-id-default` (tip 5cfde77) | IDs text→uuid+default (AuditLog text+default), migração de compatibilidade `rebuild_legacy_uuid` idempotente, teste invertido de deploy + correções guest (rate-limit Postgres, analytics/robots) | `20260928181000_rebuild_legacy_uuid`, `20261018090000_rate_limit` |
| #10 | `fix/estorno-email-refunded` (tip f3e93ea) | `EmailOutbox` + retentativa; atomicidade tx+outbox em estorno/admin/cancel/PIX e remoção do envio direto legado; cron-auth (`CRON_SECRET`) nas 4 rotas; schedules corrigidos p/ horário local | `20260929000000_email_outbox` |
| #11 | `feat/erp-evento-persistente` (tip f951169) | `ErpEvent` sempre persistido (não só no catch), `businessKey @unique` + pré-cheque, contrato do receptor (envelope/assinatura v1), dreno 09h | `20260930000000_erp_event` |

As correções da revisão (frentes 3–6) já foram **cherry-picked e pushadas**
para os ramos acima em 17/10/2026:

```
#9  5cfde77 ← 0acd9a9 (guest: rate-limit Postgres + analytics/robots)
#10 691db7d ← f627f9a (outbox atômico)  +  f3e93ea ← f771049 (cron-auth + schedules)
#11 f951169 ← aa95e5a (pré-cheque businessKey + contrato do receptor)
```

Ordem de merge: **#9 → #10 → #11**. Se o #11 ainda apontar para o #10,
retarget para `main` depois do merge do #10 (`gh pr edit 11 --base main`).
Se houver conflito de schema ao mergear (#9 e #10 ambos acrescentam
modelos ao fim de `schema.prisma`), manter os dois blocos — ordem entre
modelos é irrelevante.

## 2. Ordem de implantação e migrações

Ordem estrita: **#9 → #10 → #11** (o schema do combinado só é consistente
nessa ordem; produção aplica cada migração com `npm run prisma:deploy`).

1. Deploy do #9 → aplica `20260928181000_rebuild_legacy_uuid` (converte ids
   text→uuid, criando defaults; é idempotente e já foi exercitada em banco
   legado — dados preservados) e `20261018090000_rate_limit` (tabela do
   rate-limit guest — sem dependência dos demais PRs).
2. Deploy do #10 → aplica `20260929000000_email_outbox` (enum + tabela).
3. Deploy do #11 → aplica `20260930000000_erp_event` (coluna + unique).

Migrações são **forward-only**; nunca reescrever histórico já aplicado.

## 3. Variáveis de ambiente

Nenhuma variável NOVA é obrigatória. Já existem em produção:
`DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_DRIVER`, `CRON_SECRET`, `JWT_SECRET`.
O outbox usa o mesmo driver de e-mail já configurado (`EMAIL_DRIVER=resend`);
`ERP_WEBHOOK_URL/SECRET` continuam opcionais (sem eles o drain ERP fica em
dry-run/log).

Após o merge do #10, **o `EMAIL_DRIVER` passa a valer de verdade para os
e-mails de status/estorno** (antes do PR eles eram envio direto sem
retentativa; agora entram no outbox com até 5 tentativas).

## 4. Inspeção das filas antes/depois

Antes de liberar o dreno ERP, inspecionar (o dreno roda no cron de 09h
local — `/api/cron/carrinho-abandonado`, que também drena o outbox — e no
reprocesso manual do admin; confira `ERP-EVENTOS-PERSISTENTES.md` §dreno):

```sql
SELECT status, count(*) FROM "ErpEvent" GROUP BY status;
SELECT status, count(*) FROM "EmailOutbox" GROUP BY status;
-- Pendências legadas do 7653 (deve ser 0 ou apenas SENT/FAILED antigos):
SELECT id, "businessKey", status FROM "ErpEvent"
 WHERE "businessKey" LIKE 'pedido_estornado:%' ORDER BY "createdAt" DESC;
```

Reprocessamento: nunca forçar replay de eventos antigos sem necessidade
(ex.: 7653 — já estornado e estornado de novo). Retentativas do outbox são
autossuficientes (`nextAttemptAt`).

## 5. Efeitos observáveis pós-publicação

- `vercel.json` (raiz e `apps/web`) agenda: carrinho 09h, avaliações 10h,
  e-mails 18h (America/Sao_Paulo). Os handlers exigem `CRON_SECRET`
  (`Authorization: Bearer …`) — sem ele respondem 401 (fechados).
- `/api/acompanhar/reenviar` passa a contar tentativas por IP em Postgres
  (tabela `RateLimit`, 10/hora); abuso recebe a MESMA resposta genérica
  (sem 429 — não vira oráculo).
- `/acompanhar/*` deixa de disparar PageView para Meta/GA (token na URL).
- `robots.txt` ganha `Disallow: /acompanhar`.
- ErpEvents passam a ser persistidos SEMPRE (não só em erro de webhook), com
  pré-cheque de `businessKey`.

## 6. Ações manuais que NÃO fazem parte do deploy

1. **7653**: pedido já integralmente estornado (confirmado). NÃO executar
   nenhuma operação financeira.
2. Backfills `scripts/backfill-estorno-email-7653.ts` e
   `scripts/backfill-erp-estorno-7653.ts`: **dry-run por padrão**; só
   executar sob pedido explícito, e SEMPRE consultando o estado atual para
   recusar duplicação (o 7653 já tem evento/refund — esperado: 0 ações).
3. Liberação de fila ERP: só inspecionar; reprocessar caso a caso.

## 7. Monitoramento nas primeiras 24h

- Logs: `[email-outbox]`, `[acompanhar:reenviar]`, `[erp]` (erros de
  assinatura/replay do receptor).
- Métricas: contagem de `EmailOutbox` por status (FAILED não deve crescer);
  `ErpEvent` PENDING deve drenar no horário configurado.
- Crons: verificar execução real no Vercel (as 3 rotas agendadas + manual).

## 8. Plano de recuperação

- **Código**: reverter o merge do PR problemático (revert é sempre possível;
  as migrações são aditivas e compatíveis com o código anterior — o código
  antigo ignora tabelas/colunas novas).
- **Migração já aplicada que quebrar algo**: NÃO reverter migração em
  produção; forward-fix (migração nova corrigindo) + `prisma migrate resolve
  --applied` apenas com confirmação do time de DB.
- **Banco**: restauração de backup é operação do provedor (fora deste
  repositório). A reconstrução do zero pela cadeia combinada
  (`tmp-exp/rebuild-combined/run.mjs`, 28 migrações, inserts sem id OK,
  upgrade prodlike/legacy OK) é a evidência de que a cadeia converge.
- **E-mail**: se o outbox encher de FAILED (provedor fora), não há perda —
  `nextAttemptAt` agenda nova tentativa; corrigir credencial e as
  retentativas sozinhas reprocessam (at-least-once).

## 9. Validações locais (reproduzíveis, já executadas nesta revisão)

```bash
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
cd /home/opencode/projects/wt-all/apps/web
npm test        # 50 arquivos / 462 testes verdes
npm run typecheck
npm run lint
npm run build   # 85 páginas; erros "Environment variable not found:
                # DATABASE_URL" são pré-existentes do static gen (ruído,
                # idêntico no main; o build conclui)

# cadeia combinada do zero + diffs de schema:
node /home/opencode/projects/tmp-exp/rebuild-combined/run.mjs
# → 28 migrations; drift combinado-vs-schema = só os 48 rens pré-existentes;
#   prod-vs-combined = apenas pendências #10/#11/RateLimit

# upgrade em banco prodlike/legacy:
node /home/opencode/projects/tmp-exp/upgrade-test.mjs prodlike
node /home/opencode/projects/tmp-exp/upgrade-test.mjs legacy
```

Sem CI neste ambiente: os "checks" são exatamente esses comandos. Docker,
`psql` e acesso a produção não estavam disponíveis — nada acima toca em
produção.
