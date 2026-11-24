# GA4.2 — Reconciliação paginada, ainda sem envio

## Contexto do PR #26

O PR #26 contém fundação de consentimento e outbox de eventos GA4 refund. O transporte de rede permanece **hard-off**, a rotina não tem cron nem endpoint público e o PR continua em draft.

A primeira versão da função `reconcileGa4RefundIntents(limit)` consultava sempre o primeiro lote de pedidos estornados e aprovados. Se a quantidade de pedidos fosse maior que `limit`, rodadas repetidas poderiam examinar apenas esse mesmo lote, inclusive pedidos já enfileirados ou sem consentimento.

## Mudança isolada

A função agora aceita `afterOrderId` opcional, lê uma janela de `limit + 1` pedidos ordenados por `id` e retorna `nextCursor` quando existe página seguinte. O chamador continua a varredura até `nextCursor === null`. Limites permitidos: inteiros de 1 a 100. Cursor, quando fornecido, deve ser UUID.

Exemplo **meramente ilustrativo** de execução controlada, em ambiente de teste, por um chamador autenticado e autorizado:

```ts
let cursor: string | undefined;
do {
  const page = await reconcileGa4RefundIntents(20, cursor);
  // Persistir métricas e registrar falhas antes de continuar.
  cursor = page.nextCursor ?? undefined;
  if (!page.nextCursor) break;
} while (true);
```

**Não instalar esse loop em produção.** Ainda faltam autorização operacional, limites por job, monitoramento, política de retry/erros, retenção e um scheduler aprovado. A cada execução da função, `enqueueGa4RefundIfAuthorized` valida o estado financeiro e o consentimento; eventuais entradas existentes permanecem idempotentes pela chave UNIQUE da outbox.

### Propriedades e limites

- Sem envio de eventos externos, sem acesso ao Mercado Pago e sem alteração do financeiro.
- `checked` contabiliza pedidos da página e `skipped` contabiliza pedidos não elegíveis. Erros isolados incrementam `errors`.
- `nextCursor` representa o último ID da página atual se outra linha foi encontrada. Quando nulo, encerra a varredura.
- O cursor de UUID ordenado por ID **não representa ordem cronológica**. Uma varredura é uma visão em movimento: pedidos novos podem surgir com ID anterior ao cursor e exigem um ciclo completo posterior. Não há snapshot transacional entre páginas.
- Caso `errors > 0`, o operador deve revisar/reexecutar com política explícita. Não há reenvio automático de eventos GA4 aceitos/incertos.
- Não há checkpoint persistente, cron ou interface pública; a chamada é exclusivamente interna nesta fase.

## Bloqueios que permanecem no PR #26

1. Consentimento/revogação cross-device e cookie perdido; prova de posse do pedido, inclusive guest.
2. Corrida entre revogação e transporte remoto; status PROCESSING expirado e entrega incerta exigem tratamento humano.
3. Política LGPD de retenção/exclusão de token, identidade e eventos; revisão de cookies/CSRF.
4. Reconciliação da base `purchase.value` de compras antigas versus `refund.value` (sem reemitir eventos reais).
5. Drift de migrations do schema legado ainda não resolvido; validar upgrade real e teste de integração com PostgreSQL e fluxos de webhook de teste.
6. Plano de observabilidade, autorização e execução de worker/scheduler; transporte continua desligado.

A documentação de auditoria antiga contém achados já parcialmente corrigidos no código (por exemplo, o fallback fraco de `JWT_SECRET` foi removido em `ga4-browser-consent.ts`). Sempre comparar o documento à branch corrente antes de tratar cada item como pendente.

**Sem autorização de merge, deploy, migration de produção, cobrança ou estorno real, nem eventos GA4 de produção.**
