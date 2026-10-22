# Eventos ERP persistentes (PR de fila ERP)

> **STATUS ATUAL (2026-10-22): integração ERP ADIADA por decisão de
> produto — ver §9.** O código da fila permanece, intacto e ativo na
> persistência; `ERP_WEBHOOK_URL`/`SECRET` seguem ausentes e **não serão
> configurados** nesta fase. Nenhum pendente foi descartado.

Histórico desta implementação: branch `feat/erp-evento-persistente`
(empilhada sobre `fix/estorno-email-refunded` — PR #10), **merge
concluído** em 2026-10-20/21 (PRs #11/#12 → `main`).
Escopo original desta rodada: **sem merge, sem deploy, sem entrega de
eventos (webhook ERP nunca disparado aqui)** — cumprido: nenhum evento
ERP foi entregue até hoje.

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
   Repetição/concorrência → devolve a linha existente: **pré-cheque**
   `findUnique` antes do INSERT (evita um P2002 dentro de `$transaction`,
   que deixaria a transação inutilizável até o rollback) e, numa corrida
   residual, o `catch` de `P2002` devolve a linha já gravada.
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
7. **Contrato com o receptor** (sistema ERP, fora deste repositório):
   envelope `{event_id, versao, tipo, ocorrido_em, dados}` + cabeçalhos
   `x-erp-evento`, `x-erp-ts`, `x-erp-assinatura: v1=<hmac-sha256(ts.corpo)>`.
   `verificarAssinaturaErp` (timing-safe) está exportada para o receptor
   reutilizar. Recomendação ao receptor: rejeitar `x-erp-ts` fora de uma
   janela (ex.: ±5 min) para limitar replay — o emissor assina o timestamp
   de cada tentativa, então retentativas legítimas sempre trazem ts novo.

## 3. Ativação da integração (após merge/deploy)

1. Configurar no painel Vercel: `ERP_WEBHOOK_URL`, `ERP_WEBHOOK_SECRET`
   (hoje **ausentes** — por isso nenhum evento nunca foi entregue).
2. Com config ativa, o dreno entrega linhas `PENDING` vencidas:
   - cron diário (janela das 09h de Araguaina = `0 12 * * *` UTC;
     `/api/cron/carrinho-abandonado` já chama `drenarEventosErp`);
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

1. ~~Ordem de merge + deploy + migrações~~ — **CONCLUÍDO em 2026-10-20**
   (#9→#10→#11→#12; `20261017210000_email_outbox` e
   `20261017220000_erp_event_business_key` aplicadas às 14:43 UTC).
2. Confirmar `EMAIL_DRIVER=resend` + `RESEND_API_KEY` + `CRON_SECRET`
   no painel do deployment ativo. **Pendente — não verificável sem
   credencial do painel** (o `401` público das rotas cron não prova nada).
3. Configurar `ERP_WEBHOOK_URL` + `ERP_WEBHOOK_SECRET` **somente** quando a
   integração for ativada (§8). Enquanto o `ERP_WEBHOOK_SECRET` não
   existir, `config()` devolve `null` e **nenhuma entrega acontece** — o
   evento fica guardado.
4. Só quando autorizado: `--aplicar` dos dois backfills do 7653
   (e-mail e evento ERP) e acompanhamento do dreno. Dry-runs executados em
   2026-10-20 (somente leitura; nenhum `--aplicar`).

## 8. Receptor esperado e ativação gradual

**Fallback removido (correção de comportamento)**: `config()` **exige**
`ERP_WEBHOOK_URL` explícita + `ERP_WEBHOOK_SECRET`. O fallback automático
`NEXT_PUBLIC_APP_URL + "/erp/hooks"` foi **removido** — essa rota não existe
(`/erp/hooks` → 404 em produção, verificado em 2026-10-20) e faria "segredo
sem URL" virar entrega a destino morto (`FAILED`/`DEAD`).

**HTTPS obrigatório em produção**: a URL precisa ser **absoluta** e, quando
`NODE_ENV=production`, usar **HTTPS** (`ehUrlErpValida`). HTTP é aceito apenas
em dev/teste (receptor local de homologação). Configuração inválida ou
incompleta (URL ausente/não-absoluta/HTTP em produção, ou secret ausente)
faz `config()` devolver `null` **sem `fetch`**, **preserva** os eventos
pendentes na fila e emite **diagnóstico sanitizado** (um motivo genérico, sem
valores de URL/segredo — `motivoConfigInvalida()`). Sem URL válida ou sem
segredo, `config()` = `null`: **nenhuma entrega acontece**, mas o evento é
**persistido** (fila guarda o histórico; `enfileirarEvento` não depende de
configuração).

**Contrato do envelope implementado** (`apps/web/src/lib/erp.ts`):

| Item | Valor |
|---|---|
| Método/rota | `POST` na URL de `ERP_WEBHOOK_URL` |
| Autenticação | header `x-erp-assinatura: v1=<hex>` = HMAC-SHA256(`${ts}.${corpo}`, `ERP_WEBHOOK_SECRET`) |
| Timestamp | header `x-erp-ts` (ms) + campo `ocorrido_em` (ISO) |
| Tipo | header `x-erp-evento` e campo `tipo` |
| Versão | campo `versao: 1` (ignorado por receptores antigos) |
| Identificador | campo `event_id` (uuid; PK da fila) |
| Deduplicação | `businessKey` única (ex.: `pedido_estornado:{orderId}`) + `event_id` |
| Resposta esperada | `2xx` = `DELIVERED`; `4xx` = `FAILED` (rejeição determinística); `408`/`429`/`5xx`/rede = retentativa `PENDING` |
| Tempo/retentativas | timeout 10 s, 3 tentativas internas, depois backoff `min(2^n,60)` min, máx. 5 → `DEAD` |

**Dados necessários do sistema receptor** (a configurar — não inventados
aqui): URL real do endpoint, segredo compartilhado (≥32 bytes), formato
esperado do `dados` por tipo de evento, e confirmação de que aceita o
header `x-erp-assinatura` no formato `v1=`.

**Plano de ativação gradual** (não executado):

| Fase | Ação | Critério de saída |
|---|---|---|
| 0 | receptor de teste (ambiente de homologação do ERP) + `ERP_WEBHOOK_URL`/`SECRET` apontando para ele | receptor recebe e valida assinatura |
| 1 | evento sintético sem dados pessoais (ex.: `tipo=produto_atualizado` com payload fake) via script/fila de teste | `DELIVERED` com `lastStatusCode=200` |
| 2 | persistência histórica do 7653 (`--aplicar` do backfill ERP, **sem entrega** enquanto o receptor for de teste) | linha `PENDING` com `businessKey` correta |
| 3 | dreno controlado (cron 12:00 UTC ou `POST /api/admin/erp?acao=reprocessar` com sessão admin) | evento entregue, fila limpa |
| 4 | liberação dos fluxos reais (já ativos por código: `notificarErp()` persiste e entrega com configuração) | monitorar `ErpEvent` nas primeiras 24 h |

Separação obrigatória: **persistência histórica** (grava `ErpEvent`, sem
fetch) ≠ **entrega externa** (configuração + dreno). Fazer uma não faz a
outra.

## Análise somente-leitura do histórico (candidatos a reconstrução)

Levantamento da produção via pool de sessão (sem escrita) em 2026-10-21.
Contagens: 9 pedidos, 1 `Refund`, 10 produtos, 1 `ErpEvent` já existente
(`pedido_cancelado` de DC-20261017-8422, `PENDING`), 12 `AuditLog` (todos
`Upload` — **sem** trilha de pagamento/cancelamento/estorno).

**Eventos de negócio candidatos** (pago / cancelado / estornado), separados
dos movimentos de estoque:

| Tipo | Candidatos | Já enfileirados | Entrariam | Timestamp fonte | Precisão |
|---|---|---|---|---|---|
| `pedido_cancelado` | 8 | 1 (8422) | 7 novos | `Order.updatedAt` (proxy) | baixa — sem `cancelledAt` |
| `pedido_pago` | 1 (7653) | 0 | 1 | `Order.updatedAt` (proxy) | baixa — proxy reflete o estorno, não o pagamento |
| `pedido_estornado` | 1 (7653) | 0 | 1 | `Refund.resolvedAt` (preciso) | alta — `2026-10-17T18:34:54.611Z` |
| **total negócio** | **10** | **1** | **9** | — | 1 preciso / 9 proxy |

**Movimentos de estoque** (`estoque_atualizado`, `produto_criado`,
`produto_atualizado`): categoria **separada**; 10 produtos, mas o estoque é
*estado atual*, não histórico de diffs — **não reconstruível** retroativamente
a partir do snapshot.

**Conclusão / pendência operacional (sem decisão unilateral):**
Nenhum evento falha na validação de enfileiramento (o `enfileirarEvento` não
aplica schema de payload; todos 10 entrariam na fila). Porém **9 dos 10**
carregariam `ocorrido_em` aproximado (`updatedAt` proxy), não o instante real
da ocorrência — no caso do `pedido_pago` de 7653 o proxy é *provavelmente
errado* (marca o estorno, não o pagamento). O contrato ERP **não define** se
eventos retroativos devem ser reconstruídos; reconstruir pago/cancelado com
timestamp impreciso é **decisão de negócio pendente**. O `pedido_estornado`
de 7653 é o único com `resolvedAt` exato e já possui dry-run próprio
(`backfill-erp-estorno-7653`).

## 9. Decisão de produto (2026-10-22) — integração ERP adiada

> **Estado atual: ADIADA.** O plano de ativação da §8 **não está
> agendado**. A infraestrutura descrita acima permanece no código,
> preservada, mas **não será configurada nesta fase**.

**Decisão da direção:** adiar a integração com o Sistema-CRM e a
ativação de um ERP externo. As análises de vendas serão desenvolvidas
**dentro do painel administrativo da própria Divine Closet**, a partir
dos dados transacionais já existentes (`Order`, `OrderItem`, `Refund`).

**O que muda:**

- `ERP_WEBHOOK_URL` e `ERP_WEBHOOK_SECRET` **não serão configurados**
  nesta fase. Nenhuma ação de configuração foi tomada nesta rodada.
- A integração com o Sistema-CRM fica **adiada**. Diagnóstico de
  compatibilidade (2026-10-22) concluiu que o Sistema-CRM é um CRM de
  funil (contatos e negociação), **sem** modelos de pedido, pagamento,
  produto, estoque ou estorno, **sem** endpoint de webhook, e com o
  PocketBase em `umbrel.local:8090` — **inalcançável pela Vercel**
  (rede local, sem túnel). Não atende ao objetivo, nem mesmo com
  adaptações delimitadas.

**O que NÃO muda (preservado de propósito):**

- A **infraestrutura de eventos permanece**. `ErpEvent`, a persistência
  incondicional de `enfileirarEvento` e a `businessKey` **não são
  removidos** — continuam guardando as ocorrências de negócio.
- **Nenhum registro pendente é descartado.** O evento
  `pedido_cancelado` do pedido `DC-20261017-8422` segue `PENDING`,
  intacto. A fila segue sendo histórico, não lixo.
- A fila continua **acumulando** com a configuração ausente — exatamente
  o comportamento já documentado na §3.3 ("sem config: fila acumula — é
  o esperado até ativação; o histórico fica íntegro").
- O **backfill do evento do 7653 permanece preparado e não executado**
  (`scripts/backfill-erp-estorno-7653.ts`). Sem destino agora, continua
  aguardando decisão futura. Os 9 eventos candidatos da seção anterior
  **não** são reconstruídos.

**Análise de vendas no lugar do ERP:**

A proposta está em `ANALISE-DE-VENDAS.md`. Ponto central: o histórico é
calculado **diretamente dos dados transacionais**, sem depender de
reconstruir a fila `ErpEvent` — logo, esta decisão **não atrasa** a
análise de vendas nem compromete o histórico de negócio.

**Para reativar no futuro** (não previsto agora), nesta ordem: um
receptor real alcançável pela Vercel (o Sistema-CRM atual não é),
`ERP_WEBHOOK_URL` + `ERP_WEBHOOK_SECRET`, e então dreno controlado
conforme a tabela da §8.
