# Estorno sem e-mail + retentativa persistente (PR #10)

Estado: PR `fix/estorno-email-refunded` (branch deste documento).
Escopo desta rodada: **sem merge, sem deploy, sem envio real de e-mails.**

## 1. Causa do defeito

O fluxo de estorno (`apps/web/src/lib/estorno.ts`) confirmava o refund no
Mercado Pago e marcava o pedido `REFUNDED`, mas **nunca chamava o envio de
e-mail**:

- o template `REFUNDED` existia desde o feat de templates de status
  (`emails.statusPedido`) e a função `enviarEmailStatusPedido` era chamada
  em criação de pedido, PATCH do admin e reconciliação de Pix — **exceto no
  estorno**;
- consequência: o pedido real `DC-20261017-7653` (estorno integral de
  R$ 32,99, refund `3453063320` em 17/10) ficou `REFUNDED` **sem nenhum
  e-mail de estornado ao cliente**;
- além disso, envio "fire-and-forget" sem persistência: qualquer falha
  transitória (rede/429/5xx) perdia a notificação para sempre.

## 2. Correção (desenho implementado)

**Outbox de e-mail transacional** (`EmailOutbox` + `apps/web/src/lib/email-outbox.ts`):

1. **Renderização única + gravação atômica**: a linha do outbox (destinatário/
   assunto/texto/html) é montada pelo mesmo código de produção
   (`montarEmailStatusPedido`) e gravada **DENTRO da MESMA transação** que
   altera o pedido (`$transaction` da transição PAID→REFUNDED; idem no PATCH
   do admin, no cancelamento por Pix e na recusa de pagamento da criação do
   pedido). Rollback da transição descarta junto — nunca fica estorno
   (ou cancelamento) sem a notificação gravada.
2. **Dedupe por ocorrência**: `dedupeKey = status:{orderId}:{status}` com
   `@unique` → webhook repetido, confirmação simultânea, reprocesso ou
   mudança manual no admin geram **no máximo uma linha** (P2002 ignorado →
   devolve a linha existente; admin + estorno do MESMO pedido apontam para a
   mesma linha — nunca dois e-mails).
3. **Tentativa imediata**: logo após o commit, o fluxo tenta um envio sem
   bloquear a orquestração (fire-and-forget). A gravação já está segura; se o
   processo morrer aqui, o cron drena.
4. **SENT só após aceite**: `sendEmail` resolve apenas quando o provedor
   aceita (Resend: `error == null`); a linha vira `SENT` + `sentAt` com
   guarda `updateMany where status = PENDING` (processadores concorrentes não
   se sobrepõem). Falha → `PENDING` + `attempt` + backoff, ou `FAILED`
   definitivo.
5. **Retentativa controlada**: só `PENDING` vencida volta ao dreno
   (índice `status, nextAttemptAt`):
   - **09h** — dreno junto do cron de carrinho (`/api/cron/carrinho-abandonado`);
   - **18h** — segunda janela em `/api/cron/emails` (novo, `vercel.json`);
   - máximo de 6 tentativas; backoff `min(2^attempt, 60)` minutos;
   - falha transitória (rede/408/429/5xx/concorrência na chave) → repete;
      falha definitiva (configuração ausente, validação, driver desconhecido)
      → `FAILED` sem queimar tentativas (`EmailNaoAceito.retryable`).
6. **Idempotência no provedor**: TODA tentativa envia a mesma
   `Idempotency-Key` = `dedupeKey` com payload idêntico (imutável) —
   requisição incerta (timeout após o provedor ter aceitado) não duplica.

**Todos os e-mails de status passam pelo outbox** (função direta
`enviarEmailStatusPedido` removida — envio direto era o defeito). Exceção
conhecida: a confirmação de compra (`emails.orderPaid` em
`pedidos/finalizar.ts`) ainda é envio direto pós-commit, sem retentativa —
fora do escopo desta correção, anotado como pendência.

## 3. Limitações documentadas

- **Resend `Idempotency-Key`**: janela de 24h (chave ≤ 256 chars). Tentativa
  incerta original + retentativa **após 24h** pode duplicar (com a fila
  cron diária isso é possível: janelas de 09h/18h). Mitigação: a 1ª tentativa
  acontece de imediato na transição (majoritária); para janelas menores,
  upgrade do plano Vercel (Pro = cron por minuto) ou scheduler externo.
- **Payload idêntico obrigatório**: o Resend só deduplica com o mesmo corpo —
  por isso o payload é gravado na enfileiração e nunca re-renderizado.
- **Driver SMTP** (`EMAIL_DRIVER=smtp`): não participa do
  `Idempotency-Key` (cabeçalho específico do Resend); falhas são tratadas
  como transitórias. Produção usa **resend** (confirmar
  `EMAIL_DRIVER=resend` + `RESEND_API_KEY` no painel Vercel — pendência).
- **Plano Hobby do Vercel**: cada cron roda **no máx. 1x/dia** (expressões
  mais frequentes falham no deploy) — por isso duas janelas fixas (09h/18h)
  em vez de retentativa a cada minuto.
- `EmailOutbox.orderId` **sem FK** (mesmo critério de auditoria da fila ERP):
  linhas sobrevivem a remoção hipotética de pedidos.
- **At-least-once no envio**: dois dronos simultâneos podem ler a mesma linha
  PENDING antes do `updateMany` de SENT; a proteção contra e-mail duplicado é
  a `Idempotency-Key` no provedor (24h) + a janela diária dos crons.

## 4. Backfill do pedido 7653 — PREPARADO, NÃO EXECUTADO

Script `scripts/backfill-estorno-email-7653.ts` (validado em dry-run):

```bash
# dry-run (padrão): só lê — imprime resumo sanitizado, não grava nada
npx tsx --tsconfig apps/web/tsconfig.json scripts/backfill-estorno-email-7653.ts

# após autorização: grava a linha PENDING no outbox (NÃO envia daqui)
npx tsx --tsconfig apps/web/tsconfig.json scripts/backfill-estorno-email-7653.ts --aplicar
```

- payload renderizado pelo código de produção (pedido é de **cliente logado**
  → link estático `/conta`, o dry-run é 100% leitura, sem token criado);
- idempotente pela `dedupeKey` (segunda execução reporta a linha existente);
- só enfileira com pedido realmente `REFUNDED`;
- **o envio só acontece no cron pós-deploy** (o script nunca envia).

## 5. Pendências operacionais (não executadas nesta rodada)

1. Deploy desta branch → `prisma migrate deploy` aplica
   `20261017210000_email_outbox` (nada de alteração manual no banco).
2. Confirmar no painel Vercel: `EMAIL_DRIVER=resend`, `RESEND_API_KEY`,
   `CRON_SECRET` presentes.
3. Executar (só quando autorizado) o backfill do 7653 e acompanhar a linha
   `PENDING → SENT` no outbox.
4. Eventos ERP ausentes do 7653 (`pedido_estornado` nunca persistido) —
   tratados no PR dedicado de fila ERP (tarefa seguinte), com procedimento
   de reconciliação equivalente (não executado aqui).
