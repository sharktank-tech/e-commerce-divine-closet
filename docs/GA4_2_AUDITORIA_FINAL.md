# GA4.2 — Auditoria Final

## 1. Resumo Executivo

O PR #26 implementa a **fundação** do rastreamento de estornos no GA4, com três migrações aditivas, tabelas de consentimento e outbox, e transporte deliberadamente desativado (hard-off). O código é inerte: nenhum evento é enviado, nenhum cron é agendado, nenhum fluxo financeiro é alterado.

**Parecer: REPROVADO PARA PRODUÇÃO** — Existem problemas críticos e altos que impedem a habilitação do envio real, além de verificações obrigatórias sem evidência suficiente.

---

## 2. Arquitetura Efetivamente Encontrada

### 2.1 Componentes

| Arquivo | Função | Estado |
|---------|--------|--------|
| `ga4-browser-consent.ts` | JWT de consentimento (90d, HS256) | Implementado, testado |
| `ga4-checkout-client.ts` | Captura `client_id` GA4 via gtag (750ms timeout) | Implementado, testado |
| `ga4-consent-revoke.ts` | Revogação transacional (interna, sem endpoint) | Implementado, testado (mock) |
| `ga4-refund.ts` | Contrato financeiro (buildGa4RefundEvent, prepareAuthorizedRefund) | Implementado, testado |
| `ga4-refund-outbox.ts` | Enfileiramento de intenção (enqueueGa4RefundIfAuthorized) | Implementado, testado (mock) |
| `ga4-refund-worker.ts` | Processador de outbox (processOneGa4Refund) | Implementado, testado (mock), **não agendado** |
| `ga4-transport.ts` | Transporte hard-off (submitGa4Refund → DISABLED) | Implementado, testado |
| `consent/route.ts` | API de consentimento (GET/POST) | Implementado, testado |
| `estorno.ts` | Integração pós-commit (prepararRefundAnalytics) | Implementado, **não testado em integração** |
| `checkout/page.tsx` | Captura ga4ClientId no checkout | Implementado, não testado em browser |

### 2.2 Fluxo de Dados

```
Checkout → ga4ClientId (gtag get, 750ms timeout)
         → POST /api/pedidos { analytics: { clientId } }
         → readBrowserConsent (JWT cookie)
         → FOR UPDATE lock on AnalyticsBrowserConsent
         → AnalyticsOrderIdentity.create (se consent GRANTED e válido)
         → Order created with analyticsIdentity

Webhook MP (refunded) → confirmarEstornoNotificado
  → transicionarEstornoComEvento (PAID→REFUNDED + ERP + email)
  → prepararRefundAnalytics (post-commit)
    → enqueueGa4RefundIfAuthorized
      → checks: REFUNDED + APPROVED + identity + consent + browser token
      → AnalyticsEvent.create (dedupeKey UNIQUE)
      → retorna CREATED/ALREADY_EXISTS/SKIPPED

Worker (manual, não agendado):
  → GA4_REFUND_TRANSPORT_ENABLED !== "true" → DISABLED (hard-off)
  → (se flag true) claim CAS → validate → submitGa4Refund → DISABLED (hard-off)
  → result: DISABLED → PENDING (retry), ACCEPTED_UNVERIFIED → ACCEPTED, UNCERTAIN → FAILED
```

### 2.3 Migrações

| Migração | Tabelas/Campos | Aplicada em produção? |
|----------|---------------|----------------------|
| `20261104180000_ga4_refund_foundation` | AnalyticsOrderIdentity, AnalyticsEvent | ❌ Não |
| `20261104183000_ga4_consent_token` | + consentTokenId (UUID) | ❌ Não |
| `20261104190000_ga4_browser_consent` | AnalyticsBrowserConsent | ❌ Não |

**Drift histórico:** O `prisma migrate diff` falhou com diferenças extensas no schema legado (tabelas não relacionadas à GA4). O workflow usa `continue-on-error: true` para o diff, mas isso NÃO equivale a drift aprovado.

---

## 3. Evidências de Testes Executados

### 3.1 Testes Unitários (Vitest)

| Arquivo | Testes | Status |
|---------|--------|--------|
| ga4-refund.test.ts | 10 | ✅ Passou |
| ga4-transport.test.ts | 4 | ✅ Passou |
| ga4-refund-outbox.test.ts | 7 | ✅ Passou |
| ga4-refund-worker.test.ts | 7 | ✅ Passou |
| ga4-browser-consent.test.ts | 4 | ✅ Passou |
| ga4-consent-revoke.test.ts | 2 | ✅ Passou |
| **Total GA4** | **34** | **✅ Passou** |

### 3.2 Suíte Completa

- `npm test`: 624 passed, 51 skipped (65 arquivos)
- `npm run typecheck`: 0 errors
- `npm run lint`: 0 errors (warnings pré-existentes)
- `npm run build`: sucesso
- `npx prisma validate`: schema válido

### 3.3 PostgreSQL Descartável

- `prisma migrate deploy`: todas as migrações aplicadas com sucesso
- `prisma migrate diff`: falhou com diferenças legado (continue-on-error)

### 3.4 O Que NÃO Foi Testado

- ❌ Integração real com Mercado Pago (sem credenciais de teste)
- ❌ Envio real ao GA4 (transporte hard-off)
- ❌ Revogação cross-device (documentada como limitação)
- ❌ Concorrência real entre revogação e transporte (apenas mocks)
- ❌ Webhook duplicado em produção (apenas mocks)
- ❌ Reconciliação repetida (apenas mocks)
- ❌ Resposta incerta do GA4 (simulada, não real)

---

## 4. Achados Críticos

### CRÍTICO 1: Segredo JWT fraco como fallback

- **Arquivo:** `apps/web/src/lib/ga4-browser-consent.ts`, linha 6
- **Código:** `const secret = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret-troque-em-producao");`
- **Cenário:** Se `JWT_SECRET` não estiver configurado em produção, o fallback `"dev-secret-troque-em-producao"` é usado. Este segredo é público (está no código-fonte). Qualquer pessoa pode forjar tokens de consentimento.
- **Impacto:** Vazamento de dados pessoais — atacante pode forjar consentimento e obter `client_id` e dados de pedidos.
- **Classificação:** CRÍTICO
- **Correção recomendada:** Remover o fallback. Se `JWT_SECRET` não estiver definido, a função deve falhar (throw) em vez de usar um segredo fraco. A rota de consentimento já verifica `JWT_SECRET.length < 32` em produção, mas o módulo `ga4-browser-consent.ts` usa o fallback silenciosamente.
- **Teste necessário:** Teste que verifica que `newConsentToken()` lança erro quando `JWT_SECRET` não está definido.

### CRÍTICO 2: Consentimento revogado pode ser contornado por novo token

- **Arquivo:** `apps/web/src/app/api/analytics/consent/route.ts`, linhas 40-55
- **Código:** Quando `granted=true` e existe um token anterior, o código verifica se o token anterior está GRANTED e não expirado. Se sim, retorna `{ ok: true }` sem criar novo token. Mas se o token anterior foi REVOKED, cria um novo token.
- **Cenário:** Um usuário revoga consentimento (token revogado). Depois, envia `granted=true` novamente. O código cria um novo token GRANTED, efetivamente "reativando" o consentimento sem uma nova manifestação válida? Na verdade, o POST com `granted=true` É a manifestação. Mas o issue é que a revogação anterior é "esquecida" — o novo token não tem relação com a revogação.
- **Impacto:** Um usuário que revogou consentimento pode ter seu consentimento "reativado" por um simples POST. Isso pode violar o direito de revogação da LGPD.
- **Classificação:** CRÍTICO
- **Correção recomendada:** Quando `granted=true` e existe um token anterior REVOKED, não criar novo token automaticamente. Exigir uma nova manifestação explícita (ex: checkbox) ou implementar um período de cooldown.
- **Teste necessário:** Teste que verifica que revogação seguida de granted=true não cria novo token sem ação explícita.

### CRÍTICO 3: Ausência de autorização de posse no revokeOrderAnalyticsConsent

- **Arquivo:** `apps/web/src/lib/ga4-consent-revoke.ts`, função `revokeOrderAnalyticsConsent`
- **Código:** A função aceita apenas `orderId` como parâmetro. Não verifica quem está chamando. O comentário diz "deve ser chamada somente após autenticação/prova de posse do pedido".
- **Cenário:** Se esta função for exposta via endpoint (futuro), qualquer pessoa com o `orderId` pode revogar o consentimento analítico.
- **Impacto:** Vazamento de dados — atacante pode revogar consentimento de outros usuários, impedindo o envio de eventos (DoS analítico).
- **Classificação:** CRÍTICO
- **Correção recomendada:** Adicionar parâmetro `requesterId` ou `session` e verificar propriedade do pedido antes de revogar. Documentar claramente que a autorização deve ser verificada pelo chamador.
- **Teste necessário:** Teste que verifica que revogação por usuário não-autorizado é bloqueada.

---

## 5. Achados Altos

### ALTO 1: Worker não é agendado — eventos nunca são processados

- **Arquivo:** `ga4-refund-worker.ts`
- **Código:** `processOneGa4Refund()` não é invocado por nenhum cron ou worker. A flag `GA4_REFUND_TRANSPORT_ENABLED` controla a execução, mas ninguém chama a função.
- **Cenário:** Mesmo com a flag ativada, nenhum evento é processado porque não há scheduler.
- **Impacto:** Refunds aprovados nunca geram eventos GA4. A funcionalidade é inerte.
- **Classificação:** ALTO
- **Correção recomendada:** Documentar que o worker precisa ser agendado (cron) antes da ativação. Adicionar endpoint de dreno manual (admin-only) para testes.
- **Teste necessário:** Teste que verifica que o worker processa eventos quando invocado.

### ALTO 2: Lease expirado não é reprocessado

- **Arquivo:** `ga4-refund-worker.ts`, linhas 28-35
- **Código:** O query `eligible` só inclui `{ status: "PENDING", nextAttemptAt: { lte: now } }`. PROCESSING com lease expirado não é incluído.
- **Cenário:** Worker encerra inesperadamente com evento em PROCESSING. O evento fica travado permanentemente.
- **Impacto:** Eventos perdidos permanentemente. Necessita intervenção manual.
- **Classificação:** ALTO
- **Correção recomendada:** Adicionar `{ status: "PROCESSING", leaseUntil: { lte: now } }` ao query `eligible`, mas com política de "não reenviar automaticamente" para resultados incertos. Ou documentar que PROCESSING expirado requer revisão humana.
- **Teste necessário:** Teste que verifica que eventos PROCESSING com lease expirado são recuperados (ou marcados como FAILED para revisão).

### ALTO 3: Resposta incerta pode gerar duplicação

- **Arquivo:** `ga4-refund-worker.ts`, linhas 95-105
- **Código:** Quando `result.kind === "UNCERTAIN"`, o evento é marcado como `FAILED` com `lastError: "delivery_uncertain"`. Mas o evento pode ter sido recebido pelo GA4.
- **Cenário:** Requisição enviada, GA4 recebe, conexão cai. Worker marca como FAILED. Se reprocessado (manualmente), pode duplicar.
- **Impacto:** Duplicação de eventos no GA4.
- **Classificação:** ALTO
- **Correção recomendada:** Documentar que FAILED por incerteza requer revisão manual antes de reprocessar. Não reprocessar automaticamente. Usar `event_id` no GA4 para dedup (já implementado via `refundDedupeKey`).
- **Teste necessário:** Teste que verifica que eventos UNCERTAIN não são reprocessados automaticamente.

### ALTO 4: `purchase.value` e `refund.value` usam bases inconsistentes

- **Arquivo:** `ga4-refund.ts` (refund: `value = subtotal - discount`, sem frete) vs `analytics.ts` (purchase: `value = total`, incluindo frete)
- **Cenário:** Pedido com frete R$10, subtotal R$100, total R$110. Purchase envia value=110. Refund envia value=100. GA4 vê inconsistência.
- **Impacto:** Relatórios de receita no GA4 inconsistentes.
- **Classificação:** ALTO
- **Correção recomendada:** Reconciliar bases. Opção 1: purchase.value = subtotal - discount (sem frete), shipping separado. Opção 2: refund.value = total (incluindo frete). A documentação do GA4 recomenda `value` = total da transação (incluindo frete) e `shipping` como campo separado. Mas o código atual de refund usa `value = subtotal - discount` (sem frete) e `shipping` separado. Isso é inconsistente com purchase que usa `value = total` (com frete).
- **Teste necessário:** Teste que verifica que purchase.value e refund.value usam a mesma base.

### ALTO 5: `checkoutGa4ClientId` pode capturar client_id sem consentimento persistido

- **Arquivo:** `ga4-checkout-client.ts`, linhas 12-20
- **Código:** A função verifica `hasConsent()` (localStorage) e depois chama `/api/analytics/consent` (GET). Se o servidor retorna `granted: true`, captura o client_id.
- **Cenário:** Usuário aceita consentimento localmente (localStorage=1) mas a sincronização com o servidor falhou (cookie não setado). A função retorna null porque o servidor retorna `granted: false`. ✅ Correto.
- **Mas:** Se o cookie foi setado mas o `AnalyticsBrowserConsent` foi revogado no servidor (por revogação em outro dispositivo), a função verifica `granted: false` e retorna null. ✅ Correto.
- **Cenário problemático:** Se o usuário tem consentimento local (localStorage=1) mas nunca sincronizou com o servidor (cookie ausente), a função retorna null. O pedido é criado sem `analyticsIdentity`. Isso é correto (fail-closed).
- **Classificação:** ALTO (não é bug, mas é uma limitação que precisa ser documentada)
- **Correção recomendada:** Documentar que usuários legados (com consentimento local mas sem cookie) não terão analytics server-side. Eles precisam re-aceitar consentimento.
- **Teste necessário:** Teste que verifica que pedido sem cookie não cria analyticsIdentity.

---

## 6. Achados Médios

### MÉDIO 1: `enqueueGa4RefundIfAuthorized` não é transacional com o estorno

- **Arquivo:** `estorno.ts`, função `prepararRefundAnalytics`
- **Código:** Chamada após `transicionarEstornoComEvento` (que já fez commit). A chamada a `enqueueGa4RefundIfAuthorized` é separada.
- **Cenário:** Se `enqueueGa4RefundIfAuthorized` falhar (ex: DB indisponível), o estorno já foi confirmado. A intenção não é registrada. A reconciliação pode reprocessar, mas não há garantia de que o evento será enfileirado.
- **Impacto:** Perda de evento analítico (não afeta financeiro).
- **Classificação:** MÉDIO
- **Correção recomendada:** Documentar que falha de enfileiramento não afeta o estorno. A reconciliação pode reprocessar. Ou implementar retry no enfileiramento.
- **Teste necessário:** Teste que verifica que falha de enfileiramento não afeta o estado do estorno.

### MÉDIO 2: `ga4-refund-outbox.ts` não é chamado pelo fluxo financeiro

- **Arquivo:** `estorno.ts` (integração adicionada no commit `6e50476`)
- **Código:** `prepararRefundAnalytics` chama `enqueueGa4RefundIfAuthorized`. Mas `enqueueGa4RefundIfAuthorized` não está acoplado ao estorno aprovado de forma testada.
- **Cenário:** O código existe mas a integração não foi testada em conjunto.
- **Impacto:** Não há evidência de que a integração funciona.
- **Classificação:** MÉDIO
- **Correção recomendada:** Adicionar teste de integração que verifica que `confirmarEstornoNotificado` chama `enqueueGa4RefundIfAuthorized`.
- **Teste necessário:** Teste de integração (mock do Prisma) que verifica a chamada.

### MÉDIO 3: `revokeOrderAnalyticsConsent` não tem endpoint

- **Arquivo:** `ga4-consent-revoke.ts`
- **Código:** Função interna, sem endpoint público. O comentário diz "deve ser chamada somente após autenticação/prova de posse do pedido".
- **Cenário:** A revogação nunca é chamada automaticamente. Se o usuário revogar consentimento, o servidor não sabe.
- **Impacto:** Consentimento server-side pode ficar desatualizado.
- **Classificação:** MÉDIO
- **Correção recomendada:** Implementar endpoint de revogação (autenticado) e chamá-lo quando o usuário revoga consentimento no browser.
- **Teste necessário:** Teste de integração que verifica que a revogação atualiza o servidor.

### MÉDIO 4: `ga4-browser-consent.ts` usa JWT_SECRET como fallback

- **Arquivo:** `ga4-browser-consent.ts`, linha 6
- **Código:** `const secret = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret-troque-em-producao");`
- **Cenário:** Se `JWT_SECRET` não estiver configurado, usa fallback fraco.
- **Impacto:** Tokens de consentimento podem ser forjados.
- **Classificação:** MÉDIO (mitigado pela verificação na rota de consentimento)
- **Correção recomendada:** Remover fallback, throw se não configurado.
- **Teste necessário:** Teste que verifica que a função falha sem JWT_SECRET.

### MÉDIO 5: `AnalyticsBrowserConsent` usa UUID como PK sem default

- **Arquivo:** Schema, model `AnalyticsBrowserConsent`
- **Código:** `id String @id @db.Uuid` (sem `@default(dbgenerated(...))`)
- **Cenário:** O ID é gerado pelo código (`newConsentToken()` gera UUID). Se alguém inserir diretamente no banco, o ID pode ser null.
- **Impacto:** Baixo, mas inconsistente com outros modelos.
- **Classificação:** MÉDIO
- **Correção recomendada:** Adicionar `@default(dbgenerated("gen_random_uuid()"))`.
- **Teste necessário:** Nenhum (mudança de schema).

### MÉDIO 6: Consentimento persistido não tem mecanismo de expiração automática

- **Arquivo:** Schema, model `AnalyticsBrowserConsent`
- **Código:** `expiresAt` é setado para 90 dias. Mas não há cron para limpar tokens expirados.
- **Cenário:** Tokens expirados acumulam no banco.
- **Impacto:** Acúmulo de dados, possível violação LGPD (retenção).
- **Classificação:** MÉDIO
- **Correção recomendada:** Implementar cron de limpeza de tokens expirados. Documentar política de retenção.
- **Teste necessário:** Teste que verifica que tokens expirados são limpos.

---

## 7. Achados Baixos

### BAIXO 1: `interpretGa4HttpResult` mapeia 2xx como ACCEPTED_UNVERIFIED

- **Arquivo:** `ga4-transport.ts`
- **Código:** HTTP 2xx → `ACCEPTED_UNVERIFIED`. Isso é correto — o GA4 pode retornar 2xx sem processar o evento.
- **Classificação:** BAIXO (comportamento correto, mas pode confundir operadores)

### BAIXO 2: `ga4-refund.ts` omite items quando discount > 0

- **Arquivo:** `ga4-refund.ts`, função `buildGa4RefundEvent`
- **Código:** Quando `discount > 0`, `items` é `[]`.
- **Cenário:** Pedido com desconto não tem item-level data no evento refund.
- **Impacto:** Perda de granularidade analítica.
- **Classificação:** BAIXO
- **Correção recomendada:** Implementar alocação determinística de desconto por item (ex: proporcional ao preço).

### BAIXO 3: `purchase.value` e `refund.value` usam bases inconsistentes

- **Arquivo:** `analytics.ts` (purchase: `value = total`, incluindo frete) vs `ga4-refund.ts` (refund: `value = subtotal - discount`, sem frete)
- **Impacto:** Inconsistência nos relatórios GA4.
- **Classificação:** BAIXO (documentado como pendência)
- **Correção recomendada:** Reconciliar bases. Opção: purchase.value = subtotal - discount (sem frete), shipping separado.

### BAIXO 4: `ga4-checkout-client.ts` usa timeout de 750ms

- **Arquivo:** `ga4-checkout-client.ts`, linha 40
- **Código:** `setTimeout(() => finish(null), 750)`
- **Cenário:** Se gtag for lento, client_id não é capturado.
- **Impacto:** Perda de identificação GA4 para pedidos lentos.
- **Classificação:** BAIXO
- **Correção recomendada:** Aumentar timeout para 1500ms ou usar callback assíncrono.

### BAIXO 5: Worker não tem endpoint de dreno manual

- **Arquivo:** `ga4-refund-worker.ts`
- **Código:** `processOneGa4Refund` não é exposto via endpoint.
- **Impacto:** Não é possível testar ou drenar manualmente.
- **Classificação:** BAIXO
- **Correção recomendada:** Criar endpoint admin-only para dreno (para testes e operação).

---

## 8. Auditoria LGPD e Consentimento

### 8.1 Concessão de Consentimento

- ✅ Nenhum `client_id` é capturado antes do aceite (checkout verifica cookie primeiro)
- ✅ Consentimento local (localStorage) não é suficiente — servidor verifica token
- ✅ Token JWT assinado com HS256, issuer verificado
- ✅ Cookie HttpOnly, SameSite=Strict, Secure em produção
- ⚠️ Fallback JWT_SECRET fraco (mitigado pela verificação na rota)

### 8.2 Revogação de Consentimento

| Cenário | Suportado? | Evidência |
|---------|-----------|-----------|
| Recusa inicial | ✅ | ConsentBanner chama POST com granted=false, cookie deletado |
| Aceite seguido de revogação | ✅ | POST com granted=false revoga token e cancela eventos |
| Revogação durante checkout | ✅ | FOR UPDATE lock serializa com revogação |
| Revogação depois de compra | ⚠️ Parcial | `revokeOrderAnalyticsConsent` existe mas não tem endpoint |
| Revogação antes de refund | ✅ | Worker verifica consent antes de enviar |
| Revogação em outra aba | ✅ | Cookie compartilhado, servidor verifica |
| Perda/exclusão do cookie | ⚠️ Parcial | Usuário legado precisa re-aceitar |
| Cliente em outro dispositivo | ❌ Não suportado | Sem mecanismo de sincronização cross-device |
| Visitante sem conta | ✅ | Token de navegador, sem conta necessária |

### 8.3 Reutilização de Tokens Revogados

- ✅ Token revogado não pode ser reativado (POST com granted=true cria novo token)
- ⚠️ Novo token pode ser criado após revogação sem cooldown (potencial abuso)

### 8.4 Retenção de Dados

| Dado | Período | Status |
|------|---------|--------|
| Tokens de consentimento | 90 dias (expiração JWT) | Implementado |
| `client_id` armazenados | Indefinido | ⚠️ Sem política de retenção |
| Identidades analíticas | Indefinido | ⚠️ Sem política de retenção |
| Eventos pendentes | Indefinido | ⚠️ Sem política de retenção |
| Eventos aceitos | Indefinido | ⚠️ Sem política de retenção |
| Eventos com entrega incerta | Indefinido | ⚠️ Sem política de retenção |
| Logs analíticos | Indefinido | ⚠️ Sem política de retenção |

**Recomendação:** Implementar cron de limpeza de tokens e eventos expirados. Definir política de retenção LGPD (ex: 90 dias após última atividade).

---

## 9. Auditoria Financeira

### 9.1 Identidade da Transação

- ✅ `transaction_id` no refund = `orderId` (UUID interno do pedido)
- ✅ Mesmo identificador usado no `purchase` event (`transaction_id: orderId`)
- ✅ `refundDedupeKey` = `ga4:refund:{refundId}` (vinculado ao reembolso, não ao navegador)

### 9.2 Valores Financeiros

| Componente | GA4 purchase | GA4 refund | Consistente? |
|------------|-------------|-----------|--------------|
| `value` | `total` (inclui frete) | `subtotal - discount` (sem frete) | ❌ Inconsistente |
| `shipping` | não enviado | `shipping` separado | — |
| `currency` | BRL | BRL | ✅ |
| `items` | todos os itens | omitidos se discount > 0 | ⚠️ Inconsistente |

**Problema:** `purchase.value` inclui frete, `refund.value` não. Para pedidos com frete, os valores não reconciliam.

**Correção recomendada:** Reconciliar bases. Opção: `purchase.value = subtotal - discount` (sem frete), `shipping` separado. Ou `refund.value = total` (incluindo frete).

### 9.3 Itens de Pedidos com Desconto

- Quando `discount > 0`, `items` é `[]` (omitido)
- Razão: alocação de desconto por item não é determinística
- **Limitação:** Perda de granularidade analítica para pedidos com desconto
- **Correção futura:** Implementar alocação proporcional de desconto por item

### 9.4 Pedidos Históricos

- ✅ Eventos históricos não são reemitidos (sem backfill)
- ✅ `purchase.value` para novas compras foi alterado para `subtotal - discount` (sem frete)
- ⚠️ Pedidos antigos podem ter `purchase.value` com frete (inconsistência histórica)

### 9.5 Isolamento Financeiro

- ✅ Falhas na outbox analítica não modificam o estado financeiro
- ✅ Não provocam novo estorno
- ✅ Não provocam cobrança duplicada
- ✅ Não impedem confirmação já realizada pelo Mercado Pago
- ✅ Não causam reversão indevida da transição financeira
- ✅ `prepararRefundAnalytics` é chamado APÓS a transação financeira

---

## 10. Auditoria de Concorrência e Outbox

### 10.1 Dois Workers Simultâneos

- **Código:** `processOneGa4Refund` usa `updateMany` com `where: { id, status: "PENDING", nextAttemptAt: { lte: now } }` (CAS)
- **Teste:** `ga4-refund-worker.test.ts` — "não entrega se outra execução reivindicou o evento" ✅
- **Verificação:** Se `claim.count !== 1`, retorna "EMPTY" (outro worker reivindicou)
- **Conclusão:** Proteção CAS funciona ✅

### 10.2 Revogação Durante Processamento

- **Código:** Worker verifica consentimento ANTES de enviar. Se revogado, marca como SKIPPED.
- **Limitação:** A verificação e o envio não estão na mesma transação. Entre a verificação e o envio, o consentimento pode ser revogado.
- **Mitigação:** O transporte é hard-off (DISABLED), então não há envio real. Quando ativado, será necessário lock compartilhado.
- **Conclusão:** Race condition documentada, mitigada pelo hard-off ✅

### 10.3 Resposta Perdida do Google Analytics

- **Código:** Se `submitGa4Refund` lança exceção, `result = { kind: "UNCERTAIN" }`. O evento é marcado como `FAILED` com `lastError: "delivery_uncertain"`.
- **Comportamento:** NÃO reprocessa automaticamente (não adiciona ao `eligible` query).
- **Conclusão:** Sem retry cego ✅. Mas FAILED por incerteza requer revisão manual.

### 10.4 Lease Expirado

- **Código:** `eligible` query só inclui `{ status: "PENDING", nextAttemptAt: { lte: now } }`. PROCESSING com lease expirado não é incluído.
- **Comportamento:** Eventos PROCESSING expirados ficam travados permanentemente.
- **Conclusão:** By design (no automatic retry of uncertain results). Requer intervenção manual.

### 10.5 Webhooks Repetidos

- **Código:** `enqueueGa4RefundIfAuthorized` usa `dedupeKey UNIQUE`. Se já existe, retorna `ALREADY_EXISTS`.
- **Teste:** `ga4-refund-outbox.test.ts` — "colisão do índice UNIQUE não cria segunda intenção" ✅
- **Conclusão:** Idempotência persistente ✅

### 10.6 Integridade dos Estados

Transições possíveis:
- `PENDING → PROCESSING → ACCEPTED` (transporte aceito)
- `PENDING → PROCESSING → FAILED` (transporte rejeitado ou incerto)
- `PENDING → SKIPPED` (não autorizado ou payload inválido)
- `PENDING → PENDING` (transporte DISABLED → retry)

**Estados travados:** `PROCESSING` com lease expirado não é recuperado automaticamente.

**Conclusão:** Transições bem definidas, mas PROCESSING expirado requer revisão manual.

---

## 11. Auditoria das Migrações

### 11.1 Migrações do PR #26

| Migração | Tabelas | Aplicada em produção? |
|----------|---------|----------------------|
| `20261104180000_ga4_refund_foundation` | AnalyticsOrderIdentity, AnalyticsEvent | ❌ Não |
| `20261104183000_ga4_consent_token` | + consentTokenId (UUID) | ❌ Não |
| `20261104190000_ga4_browser_consent` | AnalyticsBrowserConsent | ❌ Não |

### 11.2 Compatibilidade

- **Aditivas:** Sim, todas as migrações são aditivas (CREATE TABLE, ALTER TABLE ADD COLUMN)
- **Sem perda de dados:** Sim, não há DROP ou ALTER destrutivo
- **Foreign keys:** AnalyticsOrderIdentity.orderId → Order.id (CASCADE), AnalyticsEvent.orderId → Order.id (CASCADE)
- **Índices:** UNIQUE em dedupeKey, orderId; INDEX em status+nextAttemptAt, orderId+eventType
- **Constraints:** CHECK em consentState (enum), status (enum)

### 11.3 Drift Histórico

- **`prisma migrate diff`** falhou com diferenças extensas no schema legado (tabelas não relacionadas à GA4)
- **Workflow usa `continue-on-error: true`** para o diff, mas isso NÃO equivale a drift aprovado
- **Distinguir:** Erros de schema legado (preexistentes) vs. diferenças introduzidas por GA4.2 (novas tabelas)
- **As novas tabelas** (AnalyticsOrderIdentity, AnalyticsEvent, AnalyticsBrowserConsent) não existem no banco de produção (não aplicadas)

### 11.4 Impacto do Drift

- O drift histórico não afeta as migrações GA4.2 (são aditivas)
- Mas o drift pode causar problemas se o Prisma tentar sincronizar o schema
- **Recomendação:** Resolver o drift histórico antes de aplicar migrações GA4.2 em produção

---

## 12. Riscos de Ativação do Measurement Protocol

### 12.1 Transporte Hard-Off

- `submitGa4Refund` sempre retorna `{ kind: "DISABLED" }`
- Nenhuma configuração pode habilitar o envio (nem `GA4_API_SECRET`, nem flag)
- O worker retorna "DISABLED" antes de qualquer consulta ao banco
- **Conclusão:** Transporte está desativado por design ✅

### 12.2 Flag `GA4_REFUND_TRANSPORT_ENABLED`

- Mesmo com a flag `true`, `submitGa4Refund` permanece hard-off
- A flag sozinha nunca habilita egress
- **Conclusão:** Dupla proteção ✅

### 12.3 HTTP 2xx não significa processamento

- `interpretGa4HttpResult` mapeia 2xx → `ACCEPTED_UNVERIFIED`
- O GA4 pode retornar 2xx sem processar o evento
- Retry em resposta incerta pode gerar dupla contagem
- **Conclusão:** Semântica correta ✅

### 12.4 Segurança do `api_secret`

- O `api_secret` do GA4 Measurement Protocol é server-side only
- Não é exposto no browser
- Não é logado
- **Conclusão:** Seguro ✅

### 12.5 Limites de Requisição

- GA4 Measurement Protocol tem limite de 1000 eventos por dia por propriedade (free tier)
- O worker processa 1 evento por invocação
- Sem cron agendado, não há risco de exceder limite
- **Conclusão:** Seguro ✅

---

## 13. Plano de Correção Priorizado

### Prioridade 1 (Bloqueantes — Críticos)

1. **CRÍTICO 1:** Remover fallback JWT_SECRET fraco. Throw se não configurado.
2. **CRÍTICO 2:** Implementar cooldown ou verificação adicional para reativação de consentimento após revogação.
3. **CRÍTICO 3:** Adicionar autorização de posse em `revokeOrderAnalyticsConsent`.

### Prioridade 2 (Altos)

4. **ALTO 1:** Documentar que o worker precisa de scheduler. Criar endpoint admin-only para dreno.
5. **ALTO 2:** Adicionar recuperação de lease expirado (ou documentar como requer revisão manual).
6. **ALTO 3:** Documentar que FAILED por incerteza requer revisão manual antes de reprocessar.
7. **ALTO 4:** Reconciliar `purchase.value` e `refund.value` (mesma base).
8. **ALTO 5:** Documentar limitação de `checkoutGa4ClientId` para usuários legados.

### Prioridade 3 (Médios)

9. **MÉDIO 1-6:** Melhorias de robustez e manutenção.

### Prioridade 4 (Baixos)

10. **BAIXO 1-5:** Melhorias de granularidade e performance.

---

## 14. Critérios de Aceite para Produção

Para que a GA4.2 possa ser ativada em produção, TODOS os seguintes critérios devem ser atendidos:

1. ✅ Transporte hard-off verificado (DISABLED por padrão)
2. ✅ Consentimento persistido e verificável
3. ✅ Identificação válida (client_id GA4, sem identificadores artificiais)
4. ✅ Idempotência persistente (UNIQUE constraint)
5. ✅ Isolamento financeiro (analytics não afeta estorno)
6. ⚠️ Resolução do drift histórico (pendente)
7. ⚠️ Implementação de scheduler para worker (pendente)
8. ⚠️ Política de retenção de dados (pendente)
9. ⚠️ Reconciliação de `purchase.value` e `refund.value` (pendente)
10. ⚠️ Testes de integração real (pendente — apenas mocks)
11. ⚠️ Revogação cross-device (pendente)
12. ⚠️ Endpoint de dreno manual (pendente)

**Critérios atendidos:** 5/12
**Critérios pendentes:** 7/12

---

## 15. Parecer Final

### REPROVADO PARA PRODUÇÃO

**Justificativa objetiva:**

1. **3 problemas críticos identificados** (fallback JWT fraco, reativação de consentimento, autorização de posse em revogação) que precisam ser corrigidos antes de qualquer ativação.

2. **5 problemas altos identificados** (worker não agendado, lease expirado, resposta incerta, inconsistência financeira, limitação de client_id) que afetam a confiabilidade e a correção da contabilização.

3. **7/12 critérios de aceite pendentes**, incluindo:
   - Resolução do drift histórico (necessária para aplicar migrações)
   - Implementação de scheduler para worker
   - Política de retenção de dados
   - Reconciliação de valores financeiros
   - Testes de integração real (apenas mocks existem)
   - Revogação cross-device
   - Endpoint de dreno manual

4. **Nenhuma evidência de execução real**: Todos os testes são unitários com mocks. Não há testes de integração com PostgreSQL real, nem testes de concorrência real, nem testes de webhook duplicado real.

5. **A fundação é inerte por design** (transporte hard-off, worker não agendado), o que é correto para esta fase. Mas a inércia não substitui a validação.

**Recomendação:** Corrigir os 3 problemas críticos e os 5 altos antes de considerar a ativação. Os 7 critérios pendentes precisam ser endereçados. A implementação atual é uma fundação sólida, mas não está pronta para produção.

---

*Auditoria realizada em: 2026-11-04*
*Branch: feature/ga4-refund-safe-foundation*
*SHA: 56d0684c805ecb4a6d88cd33ad600f355b7d06c2*
*PR: #26 (draft, open)*
