# Runbook de publicação — PRs #9, #10, #11 (DC-20261017-7653)

> Revisão integrada de 17/10/2026; **atualizada na rodada final de 18/10**.
> Base combinada validada: branch `feat/dc7653-combinado` (worktree
> `/home/opencode/projects/wt-all`, tip `a68d582`).
> Comandos reproduzíveis: ver "Validações locais" ao final.
> **Nenhum passo abaixo foi executado em produção** — é o roteiro para o
> operador humano/CI. Este runbook contém apenas **nomes** de variáveis e
> comandos; **nunca cole valores/segredos aqui**.

## 1. O que cada PR entrega

| PR | Branch | Conteúdo | Migrações |
|----|--------|----------|-----------|
| #9 | `fix/migrations-id-default` (tip 5cfde77) | IDs text→uuid+default (AuditLog text+default), migração de compatibilidade `rebuild_legacy_uuid` idempotente, teste invertido de deploy + correções guest (rate-limit Postgres, analytics/robots) | `20260928181000_rebuild_legacy_uuid`, `20261018090000_rate_limit` |
| #10 | `fix/estorno-email-refunded` (tip f3e93ea) | `EmailOutbox` + retentativa (até **6** tentativas, backoff `min(2^n,60)`min); atomicidade tx+outbox em estorno/admin/cancel/PIX e remoção do envio direto legado; cron-auth (`CRON_SECRET`) nas 4 rotas; schedules corrigidos p/ horário local | `20260929000000_email_outbox` |
| #11 | `feat/erp-evento-persistente` (tip f951169) | `ErpEvent` sempre persistido (não só no catch), `businessKey @unique` + pré-cheque, contrato do receptor (envelope/assinatura v1), dreno 09h | `20260930000000_erp_event` |

Correções da revisão de 17/10 (frentes 3–6), já **pushadas** aos ramos:

```
#9  5cfde77 ← 0acd9a9 (guest: rate-limit Postgres + analytics/robots)
#10 691db7d ← f627f9a (outbox atômico)  +  f3e93ea ← f771049 (cron-auth + schedules)
#11 f951169 ← aa95e5a (pré-cheque businessKey + contrato do receptor)
```

### 1.1 Commits que estão SÓ na combinada (rodada final de 18/10)

A rodada final fechou lacunas **direto na combinada**; antes do merge, cada
correção precisa chegar ao PR dono (ou a um chore PR). Sem isso, o merge dos
PRs publica o código ANTIGO dessas frentes:

| Commit na combinada | Correção | Destino |
|---|---|---|
| `357deb5` | ERP concorrência: `enfileirarEvento` vira `createMany(skipDuplicates)` + `ON CONFLICT DO NOTHING` (corrida não aborta a transição; erros reais ainda propagam) | **PR #11** |
| `82a8151` | Outbox: `orderPaid` e convite de avaliação saem do envio direto e entram no outbox idempotente (`status:{id}:PAID`, `review:{id}`) + `enfileirarEmail()` genérica | **PR #10** |
| `6d5b765` | Testes do token de convidado (rotação invalida link anterior; `revokedAt` revogado→rotaciona e limpa) + comentário do contrato no schema | **PR #9** |
| `e2a4d68`, `418db58`, `720a943`, `a68d582` | Scripts versionados de PG real (`pg-real.mjs`, `upgrade-pg-real.mjs` com proteções), doc `PG-REAL.md`, DRIFT §4 reescrito, `.gitignore` | chore PR (ex.: `chore/validacao-pg-real`) após o #11 — infra, sem schema |
| `92bf792`, `ccedadc` | Este runbook | junto do chore PR |

```bash
# exemplo de cherry-pick para os PRs donos (resolver conflitos; os testes
# do PR são a régua):
git checkout feat/erp-evento-persistente && git cherry-pick 357deb5   # → #11
git checkout fix/estorno-email-refunded   && git cherry-pick 82a8151   # → #10
git checkout fix/migrations-id-default    && git cherry-pick 6d5b765   # → #9
```

### 1.2 Ordem de merge

Ordem: **#9 → #10 → #11 → chore PR**. Se o #11 ainda apontar para o #10,
retarget para `main` depois do merge do #10 (`gh pr edit 11 --base main`).
Se houver conflito de schema ao mergear (#9 e #10 ambos acrescentam modelos
ao fim de `schema.prisma`), manter os dois blocos — ordem entre modelos é
irrelevante.

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
Comprovado nesta rodada em PostgreSQL real (17.11), inclusive em base
**legada** (ids ainda TEXT): cadeia completa do zero = 28 migrações; upgrade
prodlike = 4 pendentes com dados preservados; upgrade legacy = 20 pendentes
com dados preservados (`packages/database/PG-REAL.md` §3–5).

## 3. Preview × produção

| | Preview (Vercel, por PR/branch) | Produção (após merge em `main`) |
|---|---|---|
| O que roda | build + `next build` com as env do projeto preview | deploy + `npm run prisma:deploy` na ordem #9→#10→#11 |
| Banco | **não** aplicar migração de produção em preview; se houver DB preview descartável, é só para smoke de leitura | migrações forward-only do §2 |
| Crons | handlers existem mas exigem `CRON_SECRET`; não disparar cron manual de preview | `vercel.json` ativo (§8) |
| O que validar | build sem erro, páginas-chave renderizando (com `DATABASE_URL` apontando para banco com dados — ver §4 da validação), formulários em modo leitura | §5–§9 |
| E-mail/pagamento | drivers de teste/mock — **nunca** Resend/MP reais no preview | drivers reais (§4) |

O build precisa de `DATABASE_URL` presente: sem ela o `next build` conclui,
mas com ~139 avisos `Environment variable not found: DATABASE_URL` e as
páginas dinâmicas ficam com o banner de diagnóstico (investigado nesta
rodada: é o estático gerado sem env, idêntico no `main`; com DB acessível o
build roda com **0 erros**). Produção tem a env — nenhum fix de código
necessário.

## 4. Variáveis de ambiente (somente nomes — sem valores)

Nenhuma variável NOVA é obrigatória. Já existem em produção:

| Nome | Uso | Observação pós-merge |
|---|---|---|
| `DATABASE_URL` | Prisma/build | precisa existir no build (§3) |
| `RESEND_API_KEY` | provedor de e-mail | — |
| `EMAIL_DRIVER` | driver do outbox | **valida de verdade para status/estorno/pedido-pago/convite** após #10 (antes: envio direto); confirmar `resend` |
| `CRON_SECRET` | auth dos crons | sem ele as rotas respondem 401 |
| `JWT_SECRET` | sessão | — |
| `ERP_WEBHOOK_URL`, `ERP_WEBHOOK_SECRET` | receptor ERP | opcionais: sem eles o dreno fica em dry-run/log (ativação, §5B) |

## 5. Publicação, ativação e backfills são fases SEPARADAS

**A. Publicação** = merge na ordem do §1.2 + deploy + `npm run prisma:deploy`
por PR. Só código e schema. Não muda comportamento dependente de config.

**B. Ativação** (checklist após o deploy do #11, na ordem):

1. Confirmar no painel: `EMAIL_DRIVER=resend` (+ `RESEND_API_KEY`),
   `CRON_SECRET` presente.
2. Inspecionar filas (§6) **antes** de mexer em ERP.
3. ERP: só então `ERP_WEBHOOK_URL/SECRET` (sai do dry-run) — ou deixar
   dreno em log enquanto se observa a primeira janela das 09h.
4. Conferir crons executando no Vercel (§8).

**C. Backfills** (nunca automático; dry-run por padrão; só sob pedido
explícito e consultando o estado atual para recusar duplicação):

1. `scripts/backfill-estorno-email-7653.ts` — linha no outbox do 7653
   (esperado hoje: já REFUNDED; dry-run reporta o estado).
2. `scripts/backfill-erp-estorno-7653.ts` — evento `pedido_estornado` do
   7653 (o pedido já tem refund/evento — esperado: 0 ações).
3. Liberação/reprocesso de fila ERP: caso a caso, nunca replay global.

O pedido 7653 está integralmente estornado: **nenhuma operação financeira**.

## 6. Inspeção das filas antes/depois

```sql
SELECT status, count(*) FROM "ErpEvent" GROUP BY status;
SELECT status, count(*) FROM "EmailOutbox" GROUP BY status;
SELECT kind, status, count(*) FROM "EmailOutbox" GROUP BY kind, status;
-- Pendências legadas do 7653 (deve ser 0 ou apenas SENT/FAILED antigos):
SELECT id, "businessKey", status FROM "ErpEvent"
 WHERE "businessKey" LIKE 'pedido_estornado:%' ORDER BY "createdAt" DESC;
```

`kind` esperado: `status_pedido` (estorno/admin/cancel/PIX), `order_paid`
(confirmação de compra — desde a rodada final), `review_invite` (convite de
avaliação — desde a rodada final); `dedupeKey` única por ocorrência
(`status:{id}:{status}` / `review:{id}`) garante no máximo 1 linha.

Reprocessamento: nunca forçar replay de eventos antigos sem necessidade.
Retentativas do outbox são autossuficientes (`nextAttemptAt`, até 6
tentativas, backoff `min(2^n,60)`min, janelas 09h/18h).

## 7. Efeitos observáveis pós-publicação

- Handlers de cron exigem `CRON_SECRET`
  (`Authorization: Bearer …`); sem ele respondem 401.
- `/api/acompanhar/reenviar` conta tentativas por IP em Postgres (tabela
  `RateLimit`, 10/hora); abuso recebe a MESMA resposta genérica (sem 429 —
  não vira oráculo).
- `/acompanhar/*` deixa de disparar PageView para Meta/GA (token na URL);
  `robots.txt` ganha `Disallow: /acompanhar`.
- ErpEvents passam a ser persistidos SEMPRE, com pré-cheque de
  `businessKey` — e sob corrida real o INSERT não aborta mais a transição
  do chamador (`ON CONFLICT DO NOTHING` — correção `357deb5`, §1.1).
- Confirmação de compra e convite de avaliação saem pelo outbox (retentam e
  são deduplicados), além dos e-mails de status/estorno.
- Token de convidado: reenvio ROTACIONA o hash (link antigo morre; uma linha
  por pedido), expirado/revogado → 404 genérico.

## 8. Crons

`vercel.json` (raiz e `apps/web` — idênticos), horários em **UTC** =
America/Sao_Paulo:

| Rota | UTC | Local | Papel |
|---|---|---|---|
| `/api/cron/carrinho-abandonado` | `0 12 * * *` | 09h | carrinho + **dreno do outbox** |
| `/api/cron/avaliacoes` | `0 13 * * *` | 10h | convite de avaliação (outbox `review_invite`, idempotente) |
| `/api/cron/emails` | `0 21 * * *` | 18h | 2ª janela de dreno do outbox |
| `/api/cron/reconciliar-pix` | — | manual | só gatilho manual (não agendado) |

Dreno do outbox: janelas 09h/18h + tentativa imediata pós-commit.
Plano Hobby do Vercel = 1 execução/dia por roda (por isso duas janelas
fixas, não retentativa por minuto).

## 9. Monitoramento nas primeiras 24h

- Logs: `[email-outbox]`, `[acompanhar:reenviar]`, `[erp]` (erros de
  assinatura/replay do receptor).
- Métricas: `EmailOutbox` por status (`FAILED` não deve crescer) e por
  `kind`; `ErpEvent` PENDING deve drenar nas janelas.
- Crons: verificar execução real no Vercel (3 rotas agendadas + manual).

## 10. Plano de recuperação (rollback)

- **Código**: reverter o merge do PR problemático (revert é sempre
  possível; as migrações são aditivas e compatíveis com o código anterior —
  o código antigo ignora tabelas/colunas novas). Vale também para o chore
  PR (só infra/docs — sem schema).
- **Migração já aplicada que quebrar algo**: NÃO reverter migração em
  produção; forward-fix (migração nova corrigindo) + `prisma migrate resolve
  --applied` apenas com confirmação do time de DB.
- **Banco**: restauração de backup é operação do provedor (fora deste
  repositório). A reconstrução do zero pela cadeia combinada em PostgreSQL
  real (28 migrações, inserts ORM sem id OK, upgrades prodlike/legacy com
  dados preservados — `packages/database/PG-REAL.md`) é a evidência de que
  a cadeia converge.
- **E-mail**: se o outbox encher de FAILED (provedor fora), não há perda —
  `nextAttemptAt` agenda nova tentativa; corrigir credencial e as
  retentativas sozinhas reprocessam (at-least-once; `SENT` = provedor
  aceitou — ver `EMAIL-ESTORNO-RETENTATIVA.md` §3.1–3.2).
- **Ativação**: desfazer a fase B = remover `ERP_WEBHOOK_*` (volta a
  dry-run); filas não são afetadas por rollback de código (tabelas ficam).

## 11. Validações locais (reproduzíveis, já executadas nesta revisão)

```bash
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:$PATH"
cd /home/opencode/projects/wt-all/apps/web
npm test        # 52 arquivos / 481 testes verdes (inclui concorrência em PG real)
npm run typecheck
npm run lint    # 0 erros; 17 warnings pré-existentes de <img>
npm run build   # build conclui; com DATABASE_URL de banco de teste → 0 erros

# banco de validação (PostgreSQL real descartável, versionado no repo):
node packages/database/scripts/pg-real.mjs setup      # servidor 127.0.0.1:5433
eval "$(node packages/database/scripts/pg-real.mjs env)"
node packages/database/scripts/upgrade-pg-real.mjs rebuild   # 28 migrations, inserts ok
node packages/database/scripts/upgrade-pg-real.mjs prodlike  # 4 pendentes, dados OK
node packages/database/scripts/upgrade-pg-real.mjs legacy    # 20 pendentes, dados OK
# (guards: modo rebuild|prodlike|legacy e host somente loopback — senão bloqueia)
```

Tudo acima também foi executado de um **checkout limpo** (git clone novo +
`npm ci` + `setup` com instalação apk do zero — ver `PG-REAL.md` §5).
Sem CI neste ambiente: os "checks" são exatamente esses comandos. Docker
não estava disponível — nada acima toca em produção (só bancos
`dc_pgreal_*`/`dc_concorrencia` descartáveis em 127.0.0.1).
