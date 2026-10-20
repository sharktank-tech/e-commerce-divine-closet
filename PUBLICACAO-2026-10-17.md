# Runbook de publicação — PRs #9, #10, #11, #12 (DC-20261017-7653)

> Revisão integrada de 17/10/2026; **atualizada na rodada final de 19/10**;
> **corrigida antes da publicação em 20/10/2026**.
> Composição de referência validada: `d5481ee` (merge #9→#10→#11→#12 sobre `main`).
> **Referência de código aprovada para esta publicação**: `9e878f9`
> (= `9e878f9f446760f6d99c29e51c71ce8bcc638e3d`, head do #12 no instante destas
> correções). O roteiro pode avançar com novas edições deste mesmo arquivo; o
> delta em relação a `9e878f9` deve conter **apenas** `PUBLICACAO-2026-10-17.md`
> (conferência em §12.1). O head corrente é sempre
> `git rev-parse origin/chore/pg-real-docs` — não fixar o próprio SHA aqui.
> Este runbook contém apenas **nomes** de variáveis e comandos;
> **nunca cole valores/segredos aqui**.

## 1. O que cada PR entrega

| PR | Branch | SHA | Conteúdo | Migrações |
|----|--------|-----|----------|-----------|
| #9 | `fix/migrations-id-default` | `dabe6a6` | IDs text→uuid+default (Refund/OrderTrackToken/ErpEvent), migração de compatibilidade `rebuild_legacy_uuid` idempotente, rate-limit guest, teste de revogação de token | `20260928181000_rebuild_legacy_uuid`, `20261017200000_ids_uuid_default`, `20261018090000_rate_limit` |
| #10 | `fix/estorno-email-refunded` | `ca48594` | `EmailOutbox` + retentativa (até **6** tentativas, backoff `min(2^n,60)`min); atomicidade tx+outbox em estorno/admin/cancel/PIX; `orderPaid`/convite via outbox; cron-auth (`CRON_SECRET`) nas 4 rotas; schedules corrigidos p/ horário local | `20261017210000_email_outbox` |
| #11 | `feat/erp-evento-persistente` | `84021e6` | `ErpEvent` sempre persistido (não só no catch), `businessKey @unique` + pré-cheque + `conferirOcorrencia` (conflito distingue divergência), contrato do receptor (envelope/assinatura v1), dreno 09h | `20261017220000_erp_event_business_key` |
| #12 | `chore/pg-real-docs` | ref estável `origin/chore/pg-real-docs` (tip só avança por edição deste arquivo — ver §12.1) | PG real versionado (`pg-real.mjs`, `upgrade-pg-real.mjs`), doc `PG-REAL.md`, DRIFT §4 reescrito, `.gitignore`, este runbook | — |

### 1.1 Estratégia de merge escolhida: **merge commit** (não squash, não rebase)

Os 4 heads estão em **pilha estrita** — cada branch contém o anterior
(confere com `git merge-base --is-ancestor`):

```
main ec22668
  └─ #9  dabe6a6   (contém ec22668)
       └─ #10 ca48594 (contém dabe6a6)
            └─ #11 84021e6 (contém ca48594)
                 └─ #12 chore/pg-real-docs (contém 84021e6; só doc/infra)
```

Com **merge commit** o diff de cada PR encolhe sozinho a cada merge
aplicado, porque o ancestral comum avança. Compor **squash**, o ancestral
comum NÃO avança (o SHA esmagado ≠ `dabe6a6`) e o diff do #10 volta a
mostrar as mudanças do #9 — reapresentação. Por isso a ordem e o modo:

```bash
# SHAs envolvidos (main e os 3 primeiros são fixos; o do #12 avança apenas
# quando este runbook é editado — imprima antes de mergear):
git rev-parse --short main dabe6a6 ca48594 84021e6 origin/chore/pg-real-docs

# pré-requisito: confirmar a pilha (todos devem responder "é ancestral")
git merge-base --is-ancestor ec22668 dabe6a6 && echo "#9 ok"
git merge-base --is-ancestor dabe6a6 ca48594 && echo "#10 ok"
git merge-base --is-ancestor ca48594 84021e6 && echo "#11 ok"
git merge-base --is-ancestor 84021e6 origin/chore/pg-real-docs && echo "#12 ok"
```

**Modo de execução: API do GitHub (preserva o registro de revisão e as
proteções do repositório).** Neste ambiente não há `gh`; o merge é feito por
`PUT /repos/{owner}/{repo}/pulls/{n}/merge`, um PR de cada vez, na ordem
#9 → #10 → #11 → #12, com `"merge_method":"merge"` (merge commit).

Configuração conferida antes de executar (API `GET /repos/…`):

| Item | Valor | Consequência |
|---|---|---|
| `allow_merge_commit` | `true` | merge commit **é permitido** — estratégia do §1.1 mantida |
| `allow_squash_merge` / `allow_rebase_merge` | `true` / `true` | alternativas existem, mas não são usadas (ver §1.2) |
| `allow_auto_merge` | `false` | merge automático **desabilitado** no repo — nada é habilitado |
| Proteção de `main` / rulesets | **nenhuma** (`GET …/branches/main/protection` → 404 «Branch not protected»; `GET …/rulesets` → `[]`) | não há proteção a contornar; **não usar push direto** como alternativa silenciosa |
| Permissões do token | `admin`, `push` | merge via API possível sem burlar controle algum |

```bash
# execução (um por vez; SHA exato conferido ANTES de cada merge):
#   PUT /repos/sharktank-tech/e-commerce-divine-closet/pulls/<n>/merge
#   { "merge_method": "merge",
#     "commit_title": "<título do PR>",
#     "commit_message": "DC-20261017-7653 · merge #<n> via API" }
# resposta esperada: 200 { "merged": true, "sha": "<merge commit>" }
```

Como os heads já contêm os anteriores, o diff de cada PR encolhe sozinho
assim que o predecessor entra em `main`; a **base** de cada PR seguinte,
porém, é re-apontada para `main` **por PATCH explícito** antes do merge
(§1.3) — nunca por retarget automático (que não existe:
`delete_branch_on_merge: false`).

**Conflitos**: nenhum — os 4 merges acima foram executados nesta rodada
(composição `d5481ee`) e todos vieram **limpos**, sem resolução manual,
justamente porque cada branch já contém o anterior. Só pode haver conflito
se `main` receber outros commits entre um merge e o próximo: nesse caso
resolva mantendo **os dois** blocos de `schema.prisma` (a ordem entre
modelos é irrelevante) e repita os passos de §12.1 depois do último merge.

### 1.2 Se a estratégia for **squash**

Antes de retargetar qualquer branch dependente, confira diffs e
ancestralidade — sem isso o PR reapresenta mudanças já em `main`:

```bash
# 1) após esmagar o #9 em main, o merge-base do #10 continua ec22668:
git merge-base origin/fix/estorno-email-refunded main   # == ec22668 ⇒ diff mostra o #9 de novo

# 2) encolher o diff do #10 trazendo main para dentro da branch (merge, não rebase):
git checkout fix/estorno-email-refunded && git merge main
#    repita o mesmo passo para #11 e #12 após cada squash

# 3) conferir que o diff encolheu só para as mudanças próprias:
git diff main...fix/estorno-email-refunded --name-only | wc -l
```

Se o PR for retargetado pela API (não há `gh` neste ambiente), o mesmo
comando vira um `PATCH /pulls/<n>` com `"base":"main"` — só depois do
passo 2 acima.

### 1.3 Ordem de merge e retarget EXPLÍCITO

Ordem: **#9 → #10 → #11 → #12**.

O GitHub só retargeta automaticamente quando a base é **deletada** — e o
repo está com `delete_branch_on_merge: false`. Além disso, um PR é mesclado
**na sua própria base**: com base `fix/migrations-id-default`, mesclar o #10
iria para a branch do #9, **não** para `main`. Portanto o retarget é
**explícito e obrigatório** (nunca automático):

```text
#9  base=main                          → merge
#10 base → main (PATCH) → conferir     → merge
#11 base → main (PATCH) → conferir     → merge
#12 base → main (PATCH) → conferir     → merge
```

Cada `PATCH /pulls/<n> {"base":"main"}` só acontece **depois** do predecessor
estar em `main` e o diff ter encolhido (§13). Nenhuma branch é deletada nem
reescrita.

## 2. Ordem de implantação e migrações

### 2.1 Migrações PENDENTES em produção (conferido na base real, 20/10)

Confronto `ls migrations/` (28) × `_prisma_migrations` (24) no banco de
produção — **não presumir a lista antiga**:

| # | Migração | Vem do | Natureza |
|---|---|---|---|
| 1 | `20260928181000_rebuild_legacy_uuid` | #9 | **no-op** em produção (guarda em `IF NOT precisa RETURN`: nenhum `id` das 13 tabelas legadas está em `text`; só `AuditLog.id` e `_prisma_migrations.id` seguem `text`, ambas fora da lista) |
| 2 | `20261017210000_email_outbox` | #10 | aditiva: enum + tabela `EmailOutbox` + índices |
| 3 | `20261017220000_erp_event_business_key` | #11 | aditiva: coluna `businessKey` NULL + índice único |
| 4 | `20261018090000_rate_limit` | #9 | aditiva: tabela `RateLimit` |

Já aplicada (não reexecutar): `20261017200000_ids_uuid_default`
(`finished_at` 2026-10-17 18:33 UTC, checksum confere — DRIFT §2).
**Nenhuma migração existente é modificada ou reescrita** (todas as 5 da
entrega são adições; zero alterações em arquivo já aplicado).

### 2.2 Compatibilidade (código em produção × schema ampliado)

As 4 pendentes são aditivas/no-op: o código hoje em produção (`main`
`ec22668`) não referencia `EmailOutbox`, `RateLimit` nem `ErpEvent.businessKey`
— tabelas/colunas novas são ignoradas pelo Prisma client. Nenhum `db push`,
reset, rollback destrutivo ou reescrita de histórico é usado.

### 2.3 Quando aplicar — **migrações são MANUAIS, antes do primeiro merge**

A implantação **não** aplica migrações sozinha: não há workflow de CI no
repo (`.github/workflows` vazio) e o build da Vercel é o padrão (`next build`,
root directory `apps/web`) — ele **não** roda `prisma migrate deploy`
(README §«Deploy na Vercel» → «Migrations em produção»: executar uma vez da
máquina apontando para o banco de produção). O `Dockerfile` roda
`migrate deploy` no start, mas a Vercel não usa Docker.

Como as 4 são compatíveis com o código ainda em produção (§2.2), elas são
aplicadas **antes do primeiro merge**, em ordem de nome, com:

```bash
DATABASE_URL="<url-producao>" npm run prisma:deploy
# = npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
#   (a URL nunca é impressa; ver §2.4 para conexão/backup)
```

Se a implantação passar a ser feita por pipeline, a ordem obrigatória é:
**`migrate deploy` concluído antes de servir o código que depende dele.**

### 2.4 Backup/recuperação e conexão

- **Backup pré-migração**: `pg_dump` (PostgreSQL 17.11 do prefixo
  `packages/database/PG-REAL.md`) do banco de produção gravado localmente
  (permissões `0600`, fora do repositório) **antes** do DDL, e a restauração
  é exercitada num banco descartável local — recuperação comprovada, não
  presumida. Sem isso, nenhum DDL.
- **Conexão**: mesma URL já usada nas auditorias somente-leitura (pooler
  `pgbouncer`, `sslmode=require`, sem expor credencial em comando/log);
  consultas de conferência via `psql` em modo `-A -t` com saída sanitizada.
- Migrações são **forward-only**; nunca reescrever histórico já aplicado.
  Comprovado nesta rodada em PostgreSQL real (17.11), inclusive em base
  **legada** (ids ainda TEXT): cadeia completa do zero = 28 migrações;
  upgrade prodlike = 4 pendentes com dados preservados; upgrade legacy =
  20 pendentes com dados preservados (`packages/database/PG-REAL.md` §3–5).

## 3. Preview × produção e integração Git/Vercel

### 3.1 Comportamento EFETIVO da integração Git ↔ Vercel

**Nenhum push ou merge em `main` é «sem deploy».** Registro desta rodada:

- O repositório **não** tem workflow próprio (`.github/workflows` vazio);
  a publicação é feita pela **integração GitHub da Vercel**.
- Integração **ativa e observável**: heads dos PRs carregam status
  `Vercel: success «Deployment has completed»` + check-run
  `Vercel Preview Comments` + comentários do `vercel[bot]`. Ou seja: push em
  branch gera deploy de preview; **merge/push em `main` gera deploy de
  produção**, sem etapa manual e sem «push inofensivo».
- O deploy de produção é verificado por PR pelo status `Vercel` no **SHA do
  merge commit** (contexto `Vercel`) — é a janela de acompanhamento usada em
  §1.3/§5.
- Build command é o padrão (`next build`): **não executa `prisma migrate
  deploy`**. Migração é manual e antecede os merges (§2.3).
- `allow_auto_merge = false` no repo: nenhum merge automático é possível ou
  habilitado nesta rodada.
- Sem credencial Vercel neste ambiente: histórico de crons, logs e valores de
  env **não são legíveis por API daqui** — o que é verificável é feito por
  HTTP público e por consulta ao banco (§5), e o que não é verificável fica
  registrado como pendência de painel, nunca como «ok» assumido.

### 3.2 Tabela preview × produção

| | Preview (Vercel, por PR/branch) | Produção (após merge em `main`) |
|---|---|---|
| O que roda | build + `next build` com as env do projeto preview | deploy automático na Vercel (§3.1); migração **manual** (§2.3) |
| Banco | **não** aplicar migração de produção em preview; se houver DB preview descartável, é só para smoke de leitura | migrações forward-only do §2, aplicadas antes do merge |
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

**A. Publicação** = (1) `npm run prisma:deploy` **manual, antes de qualquer
merge** (§2.3 — as 4 pendentes), depois (2) merges na ordem do §1.1 pela API,
cada um acionando o deploy automático da Vercel (§3.1). Só código e schema.
Não muda comportamento dependente de configuração e **não libera acúmulo
algum** — ver §5D.

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

### 5D. Publicação ≠ liberação de passivo (garantia de código, não de config)

Nada na publicação enfileira, reprocessa ou envia. Evidências verificadas
antes dos merges:

- **Fila ERP**: `drenarEventosErp()` começa com
  `if (!config()) return { processados: 0, entregues: 0 }` — sem
  `ERP_WEBHOOK_URL`+`ERP_WEBHOOK_SECRET` **nenhuma entrega acontece**, nem no
  cron das 09h. `notificarErp()` persiste sempre e entrega só com configuração.
  **Produção hoje: `ErpEvent` com 0 linhas** (nenhum PENDING/FAILED/DEAD,
  nenhum vencido) — não há passivo a liberar.
- **Outbox**: `EmailOutbox` **não existe** em produção (tabela vem da
  migração do #10 e nasce vazia) — nenhum e-mail histórico aguarda envio.
  `RateLimit` também inexiste (vem do #9). Backfill do 7653 continua
  fora do escopo (§5C): a publicação **não** o enfileira.
- **Comunicações transacionais já operacionais**: nada é desligado. A troca
  de envio direto para outbox do #10 preserva o envio (retentando), não o
  remove; `EMAIL_DRIVER`/`CRON_SECRET` permanecem como estão.
- **Separação exigida**: se a configuração de produção tiver
  `ERP_WEBHOOK_URL`+`SECRET` ativos (não legível daqui — §3.1), o dreno passa
  a entregar; nesse caso a ativação é fase B e a liberação de fila é fase C —
  **nesta rodada nenhuma das duas é executada**. A separação é imposta pelo
  próprio código (guardas acima) e é revalidada pelos testes
  `erp-fila.test.ts`/`erp.test.ts` (sem config → 0 entregas).
- **Crons**: só disparam nas janelas do §8 e exigem `CRON_SECRET`;
  disparo sem autorização responde 401 (verificado em §5, smoke).

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
cd /home/opencode/projects/wt-composicao/apps/web
npm test        # 52 arquivos / 485 testes verdes (inclui integração em PG real)
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

# integração PostgreSQL como subconjunto de testes (a linha "PG real" do §12):
npx vitest run src/lib/__tests__/concorrencia-erp.test.ts \
               src/lib/__tests__/integration-postgres.test.ts   # 2 arquivos / 18 testes
```

Tudo acima também foi executado de um **checkout limpo** (git clone novo +
`npm ci` + `setup` com instalação apk do zero — ver `PG-REAL.md` §5).
Sem CI neste ambiente: os "checks" são exatamente esses comandos. Docker
não estava disponível — nada acima toca em produção (só bancos
`dc_pgreal_*`/`dc_concorrencia` descartáveis em 127.0.0.1).

## 12. Composição de referência (rodada final de 19/10)

Composição de referência montada a partir do `main` atual com os heads
finais publicados: `d5481ee` (merge #9→#10→#11→#12 sobre `main`).

**Os números abaixo são da composição (`d5481ee`), não de PR isolado.**
Nenhuma execução própria de #9, #10 ou #11 isolados está registrada nesta
rodada; a validação por PR foi o que cada branch publicou anteriormente.

| Check | SHA da execução | Resultado |
|-------|-----------------|-----------|
| Suíte completa | `d5481ee` | 52 arquivos / 485 testes ✅ |
| **Integração PostgreSQL** | `d5481ee` | **2 arquivos / 18 testes** ✅ (`concorrencia-erp` 7 — duas conexões reais; `integration-postgres` 11 — PGlite) |
| typecheck | `d5481ee` | 0 erros ✅ |
| lint | `d5481ee` | 0 erros / 17 warnings pré-existentes `<img>` ✅ |
| build (com `DATABASE_URL`) | `d5481ee` | 0 erros ✅ |
| build (sem env) | `d5481ee` | exatamente 139 avisos `Environment variable not found` / 0 erros reais ✅ |

Comando da linha de PG (também em §11):

```bash
cd /home/opencode/projects/wt-d5481ee/apps/web   # worktree em detached HEAD d5481ee
eval "$(node packages/database/scripts/pg-real.mjs env)"
npx vitest run src/lib/__tests__/concorrencia-erp.test.ts \
               src/lib/__tests__/integration-postgres.test.ts    # 2 arquivos / 18 testes ✅
```

Nenhuma migração reescrita: todas 5 são adições (A), zero modificações (M).
Nenhum `node_modules` rastreado na árvore final.

### 12.1 Igualdade de árvore: composição testada × heads publicados

**Comparação de ÁRVORE COMPLETA** (sem excluir `*.md`, `*.mjs` nem
`.gitignore` — a exclusão anterior escondia justamente os arquivos do #12 e
do próprio roteiro; agora nada é omitido):

```bash
# conferência executável a qualquer momento:
BASE9E=9e878f9f446760f6d99c29e51c71ce8bcc638e3d   # referência aprovada (§topo)
TIP12=$(git rev-parse origin/chore/pg-real-docs)  # head corrente do #12

git diff --stat d5481ee $TIP12                    # composição × head atual
git diff --stat $BASE9E  $TIP12                   # referência × head atual
git diff --name-only d5481ee $TIP12               # lista completa, sem filtro
```

| Comparação | Diferença (árvore completa) | Natureza |
|---|---|---|
| `d5481ee` × `9e878f9` (referência aprovada) | **só** `PUBLICACAO-2026-10-17.md` (188+/43−) | **documental** — correções do roteiro feitas depois do teste |
| `9e878f9` × head corrente do #12 | **só** `PUBLICACAO-2026-10-17.md` | **documental** — apenas as correções desta etapa (§topo) |
| `d5481ee` × head corrente do #12 | **só** `PUBLICACAO-2026-10-17.md` | documental (soma das duas acima) |
| `d5481ee` × `84021e6` (#11) | 6 arquivos: `.gitignore`, `DRIFT-BANCO-2026-10-17.md`, `PUBLICACAO-…`, `PG-REAL.md`, `pg-real.mjs`, `upgrade-pg-real.mjs` | **documentais/infra do #12** — nenhum é código de aplicação |
| `d5481ee` × `ca48594` (#10) | código do #11 + docs do #12 | esperado — a composição **contém** o #11, que o #10 não tem |
| `d5481ee` × `dabe6a6` (#9) | código do #10 + do #11 + docs do #12 | esperado — a composição contém #10 e #11 |

Conclusão: **a árvore da composição testada (`d5481ee`) difere da referência
aprovada `9e878f9` apenas em `PUBLICACAO-2026-10-17.md`**, e esta rodada de
correções acrescenta apenas esse mesmo arquivo. Em código de aplicação,
`d5481ee`, `9e878f9` e o head corrente são **idênticos**; a diferença para o
#11 são só os 6 arquivos documentais/infra do #12. Após os merges, a mesma
comparação é feita contra `main` (§4/§5 do relatório): diferença de
**histórico** é esperada (4 merge commits), diferença de **conteúdo** precisa
ser explicada — a esperada aqui é zero em código.

Preservação por PR na composição (conferida): as 3 migrações do #9,
`ErpEvent.id @default(dbgenerated(…))`, `RateLimit`, `EmailOutbox`+enum,
migração `email_outbox`, `businessKey @unique`, migração
`erp_event_business_key`, `concorrencia-erp.test.ts` e `erp-fila.test.ts`
estão todos presentes.

## 13. Atualização de branches dependentes após cada merge

**Estratégia escolhida = merge commit (§1.1) → nenhuma branch precisa ser
atualizada.** Como cada head já contém o anterior, o ancestral comum avança
com o merge e o diff de cada PR encolhe sozinho; rebase/rework aqui só
recriaria SHAs já publicados e invalidaria o registro do §12.

Conferência pós-merge (uma linha por PR — todas devem responder `OK`):

```bash
git fetch origin
# após cada merge, na ordem #9 → #10 → #11 → #12:
git merge-base --is-ancestor dabe6a6 origin/main && echo "OK: main contém #9 (dabe6a6)"
git merge-base --is-ancestor ca48594 origin/main && echo "OK: main contém #10 (ca48594)"
git merge-base --is-ancestor 84021e6 origin/main && echo "OK: main contém #11 (84021e6)"
git merge-base --is-ancestor origin/chore/pg-real-docs origin/main \
  && echo "OK: main contém #12 ($(git rev-parse --short origin/chore/pg-real-docs))"

# e o diff de cada PR aberto deve ter encolhido para as mudanças próprias:
git diff origin/main...origin/fix/estorno-email-refunded --name-only | wc -l   # só #10
git diff origin/main...origin/feat/erp-evento-persistente --name-only | wc -l   # só #11
git diff origin/main...origin/chore/pg-real-docs --name-only | wc -l            # só #12
```

**Retarget de base é EXPLÍCITO** (§1.3): `delete_branch_on_merge: false` no
repo ⇒ não há deleção de branch e portanto **não há retarget automático**; e
mesclar um PR cuja base é outra branch levaria o merge para ela, não para
`main`. Sequência, sempre depois do predecessor em `main` e com o diff já
encolhido:

```bash
# PATCH /repos/<owner>/<repo>/pulls/<n>  {"base": "main"}   → 200
# conferir em seguida: GET /pulls/<n>  → base.ref == "main"
```

**Se a estratégia virar squash**, os comandos acima não valem: nesse caso
siga §1.2 — o re-sincronismo é obrigatório (`git merge main` em cada branch
dependente) antes de qualquer retarget, senão o PR reapresenta as mudanças
já incorporadas. Confira sempre a ancestralidade antes de retargetar:

```bash
git merge-base --is-ancestor <sha-do-merge-em-main> <branch-head> \
  && echo "OK: branch contém o merge" \
  || echo "ATENÇÃO: branch não contém o merge — sincronize antes de retargetar"
```
