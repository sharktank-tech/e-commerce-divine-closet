# GA4.2 — Fundação segura de refund (ainda sem envio)

## Estado
Esta branch contém apenas o **contrato financeiro e de elegibilidade** do evento GA4 `refund` e testes unitários. **Não há conexão com o fluxo de estorno**, migração, Measurement Protocol, cron, nem alteração da produção. Nenhum evento foi enviado.

## Regras implementadas
- Estorno precisa estar aprovado; caso contrário, o construtor rejeita.
- `transaction_id` usa o UUID do pedido (mesma identidade do `purchase` atual).
- Valores em centavos: `subtotal - discount + shipping === total`, com validação de cada item.
- `value = subtotal - discount`, sem frete; `shipping` separado; moeda BRL.
- Sem desconto, itens são incluídos conforme snapshot; com desconto de carrinho, itens ficam omitidos até existir alocação precisa por item (evita valores contraditórios).
- Identificação exige `client_id` numérico em formato GA4 e autorização verificada, não apenas booleano do navegador.
- Status DENIED, REVOKED, UNKNOWN, identificação ausente ou não verificada retornam null.
- Chave determinística `ga4:refund:<refundId>` preparada para deduplicação **UNIQUE** persistente em etapa futura.

## Pendências bloqueantes antes de ativar
1. **Consentimento:** construir registro server-side persistente e mecanismo autenticado para concessão/revogação (incluindo checkout guest); não confiar em um `analyticsConsent` bool enviado isoladamente. Verificar estado *no instante do envio*. Planejar retenção e exclusão.
2. **Identidade:** capturar via `gtag('get', GA4_ID, 'client_id', callback)` apenas após consentimento; permitir ausência e nunca inventar identificador. Associar ao mesmo pedido usando a autenticação/idempotência já existente.
3. **Modelo e migração:** adicionar dados de consentimento e identificador à associação com pedido, além de `AnalyticsEvent` com `dedupeKey UNIQUE`, estado, tentativas, lease/lock de processamento e auditoria. Fazer migration aditiva e validar upgrade em PostgreSQL local. Não aplicar em produção nesta etapa.
4. **Integração financeira:** produzir intenção somente após aprovação financeira; manter fonte da verdade no `estorno.ts`. Se outbox for escrito dentro da transação, falha de inserção não pode bloquear atualização de estorno: definir alternativa transacional, isolamento de erro e reconciliação. Nunca chamar API externa dentro da transação.
5. **Entrega MP:** somente com `GA4_API_SECRET` server-side e feature flag default OFF; validar payload no endpoint de debug (sem tratar debug como confirmação de coleta). HTTP 2xx não significa evento processado. Resposta perdida pode duplicar evento: NÃO prometer exactly-once nem dedupe automática GA4.
6. **Privacidade:** não fazer tracking em rotas privadas; não enviar e-mail, nome, token, endereço, telefone, nem logs de client_id. Revogação precisa cancelar intenções pendentes e impedir execução.
7. **Financeiro:** revisar alinhamento de `purchase.value` atual (total do pedido, pode incluir frete) com contrato recomendado GA4 (mercadorias sem frete). Evitar que `refund` e `purchase` usem bases incompatíveis. Preferir correção versionada e testes.
8. **Operação:** testar webhook duplicado, concorrência, retries, estado incerto, recusas, guest, revogação, erros de rede e reconciliação. Não fazer backfill histórico sem autorização.

## Testes desta branch
`apps/web/src/lib/__tests__/ga4-refund.test.ts`: contrato BRL, frete, desconto, total divergente, item divergente, precisão centavos, estorno pendente, dedupe key, falta/revogação/recusa de consentimento, client_id inválido.

**A executar no ambiente local:** `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`. Nenhum resultado de teste é reivindicado nesta branch enquanto não forem executados.

## Critério de avanço
Não abrir o envio real ou declarar GA4.2 concluída até os itens 1–8 estarem integrados e validados. Esta fundação foi intencionalmente desenhada para ser inerte: não afeta checkout, pagamentos, banco, cookies ou eventos de produção.

## Incremento GA4.2 — esquema e fila inertes
- Prisma: `AnalyticsOrderIdentity` tem consentimento UNKNOWN por padrão; `AnalyticsEvent` usa `dedupeKey UNIQUE` e status PENDING/PROCESSING/ACCEPTED/FAILED/SKIPPED.
- Migração aditiva proposta: `20261104180000_ga4_refund_foundation`; não aplicada.
- `enqueueGa4RefundIfAuthorized` só cria intenção PENDING para REFUNDED com Refund.APPROVED, identificação e prova de consentimento persistidas. Não envia para GA4 nem é chamada pelo fluxo financeiro.
- Testes com mocks adicionados, ainda não executados.
- Antes de qualquer ativação: captura consentida no checkout, revogação server-side, proteção de concorrência, worker com lease e política de entrega incerta. `ACCEPTED` não significa confirmação de processamento GA4.

## Incremento GA4.2 — transporte hard-off e revogação interna
- `ga4-transport.ts`: função de envio deliberadamente hard-off; `interpretGa4HttpResult` diferencia ACCEPTED_UNVERIFIED, REJECTED e UNCERTAIN. O endpoint do Google pode retornar HTTP 2xx mesmo para eventos não processados.
- `ga4-consent-revoke.ts`: função interna transacional para apagar clientId, registrar estado REVOKED e cancelar intenções PENDING/FAILED. Não existe endpoint público chamador, nem execução automática; **a autorização de posse do pedido deverá ser garantida antes de chamar esta função**.
- O processamento ainda NÃO está conectado ao estorno nem a cron; nenhum dado é enviado externamente. Os testes novos foram escritos, mas ainda não foram executados em ambiente local.
- Bloqueios restantes: associação autenticada do consentimento no checkout (inclusive guest), propagação da revogação do navegador ao servidor, captura `gtag get` consentida, concorrência transacional entre revogação e consumidor (incluindo PROCESSING), política de retry incerto, execução de migration PostgreSQL local e testes/build.

## Incremento GA4.2 — consentimento no checkout e consumidor inerte (2026-11-04)

- `AnalyticsBrowserConsent`: status GRANTED/REVOKED persistido com token aleatório UUID assinado (JWT HMAC), cookie HttpOnly, SameSite=Strict, expiração 90 dias.
- `POST /api/analytics/consent`: exige Origin de mesma origem; aceite gera/renova cookie, recusa apaga cookie, revoga todos os registros `AnalyticsOrderIdentity` com mesmo `consentTokenId` e cancela eventos PENDING/FAILED. Nenhuma chamada ao GA4.
- `ConsentBanner`: somente ativa `setConsent(true)` após retorno 2xx do servidor. A recusa client-side é imediata. Erro de rede deixa mensagem visível para tentar sincronizar revogação novamente.
- `checkoutGa4ClientId`: sincroniza aceite pré-existente no servidor, usa apenas `gtag('get', 'G-BKNS2XTSH2', 'client_id', cb)` e falha em modo null após 750 ms; não bloqueia compra.
- `POST /api/pedidos`: aceita identidade opcional. Dentro da transação, bloqueia a linha do token com `FOR UPDATE` (serializando com revogação) e somente associa identidade a pedido se GRANTED, não expirado e não revogado. Visitantes usam o mesmo token de navegador, sem expor segredo de checkout. Compras sem consentimento não são bloqueadas.
- `processOneGa4Refund`: worker **não agendado**. Flag `GA4_REFUND_TRANSPORT_ENABLED` ausente => nenhuma consulta ao banco. Mesmo com flag true, o transporte real continua **hard-off**. Claim CAS com lease, consulta estado atual do token e do pedido, rejeita payload malformado, não repete automaticamente resposta UNCERTAIN. Testes com mocks escritos.
- Migrations novas: `20261104183000_ga4_consent_token`, `20261104190000_ga4_browser_consent` além da fundação original. **Não aplicadas em produção nem em PostgreSQL local.**

### Bloqueios restantes antes de habilitar egress/merge
1. **Executar e corrigir** Vitest completo, typecheck, lint, Next build, prisma generate + validate e upgrade de migrations em PostgreSQL local. Não há resultado de execução validado aqui.
2. O worker não é invocado por cron e `enqueueGa4RefundIfAuthorized` ainda não está acoplado à confirmação de estorno. Isso é deliberado até revisão de falhas e compatibilidade com o fluxo financeiro.
3. Revogação após **perda do cookie** ou em **outro dispositivo** não pode ser inferida da preferência local anterior; é necessária política de consentimento por conta/pedido ou mecanismo autenticado adicional. O hard-off previne envio durante a pendência.
4. Antes do envio real, decidir e testar serialização entre revogação e tentativas PROCESSING. Endpoint atual cancela PENDING/FAILED, enquanto worker checa estado do token antes do transporte, mas não mantém lock compartilhado durante I/O externo. **Não existe garantia de ausência de corrida para envio real futuro.**
5. `purchase` existente usa valor da compra conforme recibo; é necessário reconciliar base econômica com `refund.value` (frete/desconto/itens) antes de autorizar contabilização.
6. O Measurement Protocol pode devolver 2xx para eventos não processados; retry em resposta incerta pode gerar dupla contagem. Política e observabilidade precisam de aceite explícito.
7. Não há sistema de limpeza/retention de tokens e eventos analíticos. Definir janela LGPD antes de produção.
