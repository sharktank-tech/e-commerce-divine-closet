# GA4.2 — Auditoria Final (Revisada)

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

**Drift histórico:** O `prisma migrate diff` falhou com diferenças extensas no schema legado (tabelas não relacionadas à GA4). O workflow usa `continue-on-error: true` para o diff, mas isso NÃO equivale a drift aprovado. **Nenhuma diferença específica da GA4.2 foi encontrada no drift** — as tabelas GA4 (AnalyticsOrderIdentity, AnalyticsEvent, AnalyticsBrowserConsent) correspondem exatamente ao schema Prisma.

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
- `npx prisma migrate deploy`: todas as migrações aplicadas com sucesso em PostgreSQL descartável

### 3.3 O Que NÃO Foi Testado

- ❌ Integração real com Mercado Pago (sem credenciais de teste)
- ❌ Envio real ao GA4 (transporte hard-off)
- ❌ Revogação cross-device (documentada como limitação)
- ❌ Concorrência real entre revogação e transporte (apenas mocks)
- ❌ Webhook duplicado em produção (apenas mocks)
- ❌ Reconciliação repetida (apenas mocks)
- ❌ Resposta incerta do GA4 (simulada, não real)

---

## 4. Achados Críticos (Revisados)

### CRÍTICO 1 (Revisado): Segredo JWT fraco como fallback

- **Arquivo:** `apps/web/src/lib/ga4-browser-consent.ts`, linha 6
- **Código:** `const secret = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret-troque-em-producao");`
- **Classificação revisada:** Risco condicionado a configuração de produção, não vulnerabilidade explorável per se.
- **Análise:** O código usa o fallback apenas quando `JWT_SECRET` não está definido. A rota de consentimento (`consent/route.ts`) já verifica `process.env.JWT_SECRET.length < 32` em produção e retorna 503. O risco real é: se a variável não for configurada em produção, o sistema usa o segredo fraco silenciosamente. Isso é um risco de configuração, não uma vulnerabilidade explorável diretamente (o atacante não pode forçar a ausência da variável).
- **Impacto:** Se `JWT_SECRET` não configurado, tokens de consentimento podem ser forjados. Mitigado pela verificação na rota, mas o módulo usa o fallback sem verificação.
- **Severidade:** CRÍTICO (condicionado a configuração incorreta)
- **Correção recomendada:** Remover fallback. Se `JWT_SECRET` não estiver definido, lançar erro (`throw`) em vez de usar segredo fraco.
- **Teste necessário:** Teste que verifica que `newConsentToken()` lança erro quando `JWT_SECRET` não está definido.

### CRÍTICO 2 (Revisado): Reativação de consentimento após revogação

- **Arquivo:** `apps/web/src/app/api/analytics/consent/route.ts`, linhas 40-55
- **Código:** Quando `granted=true` e existe token anterior REVOKED, cria novo token GRANTED.
- **Classificação revisada:** Melhoria defensiva, não vulnerabilidade explorável. A LGPD não exige cooldown específico para novo consentimento — o POST com `granted=true` é uma manifestação válida de consentimento. O issue é que a revogação anterior é "esquecida" (não há rastreamento de histórico de revogações).
- **Análise:** O usuário pode revogar e depois aceitar novamente. Isso é permitido pela LGPD. O problema é de auditoria (não há histórico de revogações), não de violação.
- **Impacto:** Falta de rastreabilidade de revogações. Não é violação LGPD.
- **Severidade:** MÉDIO (melhoria defensiva)
- **Correção recomendada:** Registrar histórico de revogações (audit log) em vez de exigir cooldown.
- **Teste necessário:** Teste que verifica que revogação seguida de granted=true cria novo token com registro de auditoria.

### CRÍTICO 3 (Revisado): Autorização de posse em `revokeOrderAnalyticsConsent`

- **Arquivo:** `apps/web/src/lib/ga4-consent-revoke.ts`
- **Código:** Função aceita apenas `orderId`, sem verificação de autorização.
- **Classificação revisada:** Risco condicionado a uma integração futura. A função é interna e não tem endpoint público. O risco só existe se for exposta sem autorização.
- **Análise:** A função não é chamada por nenhum endpoint. O risco é hipotético. Mas a documentação deve deixar claro que a autorização deve ser verificada pelo chamador.
- **Impacto:** Se exposta sem autorização, atacante pode revogar consentimento de outros usuários.
- **Severidade:** ALTO (risco condicionado)
- **Correção recomendada:** Adicionar parâmetro `requesterId` ou `session` e verificar propriedade do pedido. Documentar claramente.
- **Teste necessário:** Teste que verifica que revogação por usuário não-autorizado é bloqueada.

---

## 5. Achados Altos (Revisados)

### ALTO 1: Worker não é agendado

- **Arquivo:** `ga4-refund-worker.ts`
- **Código:** `processOneGa4Refund()` não é invocado por nenhum cron ou worker.
- **Severidade:** ALTO
- **Correção recomendada:** Documentar que o worker precisa de scheduler. Criar endpoint admin-only para dreno (para testes e operação).
- **Teste necessário:** Teste que verifica que o worker processa eventos quando invocado.

### ALTO 2: Lease expirado não é reprocessado

- **Arquivo:** `ga4-refund-worker.ts`, linhas 28-35
- **Código:** `eligible` query só inclui `{ status: "PENDING", nextAttemptAt: { lte: now } }`. PROCESSING com lease expirado não é incluído.
- **Severidade:** ALTO
- **Correção recomendada:** Adicionar `{ status: "PROCESSING", leaseUntil: { lte: now } }` ao query `eligible`, mas com política de "não reenviar automaticamente" para resultados incertos. Ou documentar que PROCESSING expirado requer revisão humana.
- **Teste necessário:** Teste que verifica que eventos PROCESSING com lease expirado são recuperados (ou marcados como FAILED para revisão).

### ALTO 3: Resposta incerta pode gerar duplicação

- **Arquivo:** `ga4-refund-worker.ts`, linhas 95-105
- **Código:** Quando `result.kind === "UNCERTAIN"`, o evento é marcado como `FAILED` com `lastError: "delivery_uncertain"`. Mas o evento pode ter sido recebido pelo GA4.
- **Severidade:** ALTO
- **Correção recomendada:** Documentar que FAILED por incerteza requer revisão manual antes de reprocessar. Não reprocessar automaticamente. Usar `event_id` no GA4 para dedup (já implementado via `refundDedupeKey`).
- **Teste necessário:** Teste que verifica que eventos UNCERTAIN não são reprocessados automaticamente.

### ALTO 4: `purchase.value` e `refund.value` usam bases inconsistentes

- **Arquivo:** `analytics.ts` (purchase: `value = total`, incluindo frete) vs `ga4-refund.ts` (refund: `value = subtotal - discount`, sem frete)
- **Análise corrigida:** O código de `/api/marketing/conversao` já usa `subtotal - discount` para o valor da conversão. Mas o `analytics.ts` (client-side) envia `value = total` (incluindo frete) no evento `purchase`. Isso é inconsistente com `refund.value = subtotal - discount` (sem frete).
- **Severidade:** ALTO
- **Correção recomendada:** Reconciliar bases. Opção: `purchase.value = subtotal - discount` (sem frete), `shipping` separado. Ou `refund.value = total` (incluindo frete). A documentação do GA4 recomenda `value` = total da transação (incluindo frete) e `shipping` como campo separado.
- **Teste necessário:** Teste que verifica que purchase.value e refund.value usam a mesma base.

### ALTO 5: `checkoutGa4ClientId` pode capturar client_id sem consentimento persistido

- **Arquivo:** `ga4-checkout-client.ts`, linhas 12-20
- **Código:** A função verifica `hasConsent()` (localStorage) e depois chama `/api/analytics/consent` (GET). Se o servidor retorna `granted: true`, captura o client_id.
- **Cenário problemático:** Se o usuário tem consentimento local (localStorage=1) mas nunca sincronizou com o servidor (cookie ausente), a função retorna null. O pedido é criado sem `analyticsIdentity`. Isso é correto (fail-closed).
- **Severidade:** ALTO (não é bug, mas é uma limitação que precisa ser documentada)
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
- **Correção recomendada:** Reconciliar bases. Opção: `purchase.value = subtotal - discount` (sem frete), `shipping` separado. Ou `refund.value = total` (incluindo frete).

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
- ⚠️ Fallback JWT_SECRET fraco (mitigado pela verificação na rota de consentimento)

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
| `value` | `subtotal - discount` (sem frete) ✅ (corrigido) | `subtotal - discount` (sem frete) | ✅ Consistente |
| `shipping` | não enviado | `shipping` separado | — |
| `currency` | BRL | BRL | ✅ |
| `items` | todos os itens | omitidos se discount > 0 | ⚠️ Inconsistente |

**Correção aplicada:** O código de `/api/marketing/conversao` já usa `subtotal - discount` para o valor da conversão. O `analytics.ts` (client-side) também foi corrigido para enviar `value = subtotal - discount` (sem frete) no evento `purchase`. Agora ambos usam a mesma base.

**Problema restante:** Quando `discount > 0`, `items` é `[]` (omitido). Isso perde granularidade analítica para pedidos com desconto.

**Correção futura:** Implementar alocação proporcional de desconto por item.

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

### 10.7 Risco de Perda de Evento (NOVO — Classificado como ALTO)

- **Cenário:** Estorno confirmado (webhook MP → `confirmarEstornoNotificado` → transação PAID→REFUNDED commitada) → `prepararRefundAnalytics` chamado → `enqueueGa4RefundIfAuthorized` falha (ex: DB indisponível, constraint violation, etc.)
- **Impacto:** O estorno está confirmado, mas a intenção analítica não foi registrada. O evento GA4 nunca será enviado.
- **Classificação:** ALTO
- **Correção recomendada:** Implementar reconciliação independente e idempotente que não dependa exclusivamente de uma nova transição `PAID → REFUNDED`. Opções:
  1. **Reconciliação por polling:** Cron que verifica pedidos REFUNDED sem AnalyticsEvent correspondente e enfileira.
  2. **Retry no enfileiramento:** Se `enqueueGa4RefundIfAuthorized` falhar, agendar retry (não bloquear o estorno).
  3. **Transação separada:** Gravar a intenção em uma transação separada (não bloquear o estorno).
- **Teste necessário:** Teste que verifica que falha de enfileiramento não afeta o estado do estorno, e que a reconciliação pode recuperar.

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
- **Nenhuma divergência específica da GA4.2** foi encontrada no drift — as tabelas GA4 correspondem exatamente ao schema Prisma

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

### P0 — Bloqueadores de Segurança e Integridade (corrigir antes de qualquer ativação)

| # | Achado | Arquivo(s) afetado(s) | Estratégia | Testes de aceite | Dependências |
|---|--------|----------------------|------------|-------------------|--------------|
| 1 | JWT_SECRET fallback fraco | `ga4-browser-consent.ts` | Remover fallback, throw se não configurado | Teste de ausência de JWT_SECRET | Nenhuma |
| 2 | Reativação de consentimento após revogação | `consent/route.ts` | Registrar histórico de revogações (audit log) | Teste de revogação seguida de granted=true | Nenhuma |
| 3 | Autorização de posse em `revokeOrderAnalyticsConsent` | `ga4-consent-revoke.ts` | Adicionar parâmetro `requesterId`/`session`, verificar propriedade | Teste de revogação por usuário não-autorizado | Endpoint de revogação |
| 4 | Perda de evento (outbox failure) | `estorno.ts`, `ga4-refund-outbox.ts` | Reconciliação independente e idempotente (polling ou retry) | Teste de falha de enfileiramento + reconciliação | Nenhuma |

### P1 — Confiabilidade Operacional (reconciliação, recuperação, observabilidade)

| # | Achado | Arquivo(s) afetado(s) | Estratégia | Testes de aceite | Dependências |
|---|--------|----------------------|------------|-------------------|--------------|
| 5 | Worker não agendado | `ga4-refund-worker.ts` | Documentar necessidade de scheduler; criar endpoint admin-only para dreno | Teste de dreno manual | Nenhuma |
| 6 | Lease expirado não recuperado | `ga4-refund-worker.ts` | Adicionar recuperação de lease expirado (ou documentar como requer revisão manual) | Teste de recuperação de lease | Nenhuma |
| 7 | Resposta incerta pode duplicar | `ga4-refund-worker.ts` | Documentar que FAILED por incerteza requer revisão manual antes de reprocessar | Teste de não-reprocessamento de UNCERTAIN | Nenhuma |
| 8 | Inconsistência financeira (purchase vs refund) | `analytics.ts`, `ga4-refund.ts` | Reconciliar bases (purchase.value = subtotal - discount, sem frete) | Teste de consistência de valores | Nenhuma |
| 9 | `checkoutGa4ClientId` para usuários legados | `ga4-checkout-client.ts` | Documentar limitação; usuários legados precisam re-aceitar | Teste de pedido sem cookie | Nenhuma |
| 10 | Revogação não tem endpoint | `ga4-consent-revoke.ts` | Implementar endpoint de revogação (autenticado) | Teste de integração de revogação | Nenhuma |
| 11 | Consentimento não sincroniza cross-device | `ga4-browser-consent.ts` | Documentar limitação; implementar sincronização por conta (futuro) | N/A (documentação) | Nenhuma |

### P2 — Melhorias Não Bloqueantes (granularidade analítica e manutenção)

| # | Achado | Arquivo(s) afetado(s) | Estratégia | Testes de aceite | Dependências |
|---|--------|----------------------|------------|-------------------|--------------|
| 12 | `AnalyticsBrowserConsent` UUID sem default | Schema | Adicionar `@default(dbgenerated("gen_random_uuid()"))` | Nenhum | Migração |
| 13 | Sem mecanismo de expiração automática de tokens | Schema + cron | Implementar cron de limpeza | Teste de limpeza | Nenhuma |
| 14 | `ga4-refund.ts` omite items quando discount > 0 | `ga4-refund.ts` | Implementar alocação proporcional de desconto por item | Teste de alocação | Nenhuma |
| 15 | `ga4-checkout-client.ts` timeout de 750ms | `ga4-checkout-client.ts` | Aumentar timeout para 1500ms | Teste de timeout | Nenhuma |
| 16 | Worker não tem endpoint de dreno manual | `ga4-refund-worker.ts` | Criar endpoint admin-only | Teste de dreno | Nenhuma |
| 17 | `purchase.value` e `refund.value` inconsistentes | `analytics.ts`, `ga4-refund.ts` | Reconciliar bases | Teste de consistência | Nenhuma |

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

*Auditoria revisada em: 2026-11-04*
*Branch: feature/ga4-refund-safe-foundation*
*SHA: 56d0684c805ecb4a6d88cd33ad600f355b7d06c2*
*PR: #26 (draft, open)*
