# GA4.2 — Sincronização de consentimento por conta e entre abas (hard-off)

## Escopo
Esta fase é um incremento sobre o PR #32, que depende do PR #26. **Não integra `main`, não ativa transporte de refunds e não executa operações financeiras.**

### 1. Verificação server-side antes de scripts de analytics
Em `TrackingScripts`, a preferência `localStorage["dc-consent"] = "1"` **não** é suficiente para instalar SDKs ou enviar `page_view`.

A cada montagem/navegação, evento de consentimento e atualização do storage de outra aba, a aplicação:
1. Coloca os SDKs em modo negado e desativa `window.dcTracking` imediatamente.
2. Faz `GET /api/analytics/consent` com `cache: no-store`, sem criar aceite.
3. Só ativa os SDKs após `{ granted: true }` explícito do servidor e confirmação de que a preferência local segue aceita.
4. Em token expirado, perdido ou revogado com resposta explícita `{ granted: false }`, desativa tracking, registra recusa local e sincroniza outras abas via `storage`. Em falha de rede, status não-2xx ou resposta inválida, desativa tracking **sem apagar a preferência local**, permitindo nova tentativa ao retomar foco.
5. Ao voltar o foco para a aba, revalida consentimento; não registra um novo `page_view` apenas por retornar ao foco.
6. Respostas antigas de uma verificação pendente não podem ativar tracking após revogação ou unmount (controle por geração).\n7. O banner de preferências acompanha alterações do `localStorage` entre abas; não concede consentimento automaticamente.

**Limite:** não é um bloqueio síncrono de todos os eventos do navegador no mesmo milissegundo de uma revogação em outro dispositivo. A aba distante descobre isso na próxima revalidação (navegação, foco, evento local), e requisições/eventos já transmitidos não são apagados retroativamente.

### 2. Revogação por conta autenticada sem cookie
`POST /api/analytics/consent { granted: false }` exige Origin válido, e ao detectar sessão `CLIENT` revoga na mesma transação de banco:
- consentimentos de navegador associados aos pedidos **já vinculados àquela conta**;
- as respectivas `AnalyticsOrderIdentity`, limpando `clientId`;
- intenções de reembolso `PENDING`/`FAILED`, marcando `SKIPPED` (não altera `PROCESSING` incerto);
- um registro de auditoria com contagem, sem payload financeiro.

Funciona mesmo que o navegador atual tenha perdido `dc_ga4_consent`. Para visitantes sem login, a revogação continua limitada às identidades associadas ao cookie analítico assinado do navegador atual. Sessões administrativas não recebem privilégio de revogar pedidos de terceiros por esse endpoint.

**Limites importantes:**
- A revogação por conta cobre *pedidos já associados à conta*, não garante uma política permanente de proibição de rastreamento em qualquer novo dispositivo/novo pedido. Um novo consentimento explícito continua permitido.
- Pedidos de visitantes não associados ao login precisam de mecanismo separado de prova de posse e revogação.
- A concorrência entre revogação, criação de novos pedidos e transporte remoto futuro ainda requer prova de serialização e testes com PostgreSQL real em condições de corrida.
- O endpoint ainda pode sofrer problemas de escala com contas com muitos pedidos/tokens; estabelecer limites operacionais e retenção antes de produção.
- Acesso via `GET /api/analytics/consent` verifica o token do navegador; não consulta a preferência de conta futura.
- Caso haja mais de um usuário usando o mesmo navegador/token, a revogação desse token é compartilhada; revisar produto/política antes da liberação.

## Revisões obrigatórias (não implementadas)
- Testes reais de concorrência de entrega/revogação, com processo de envio externo simulado e locks PostgreSQL.
- Política LGPD de exclusão/retention de tokens, outbox e registros auditáveis.
- Modelo de revogação guest e de account-wide *para novos pedidos*, não apenas pedidos já vinculados.
- Harmonizar `purchase.value` histórico com `refund.value` e validar se eventos antigos são elegíveis.
- Auditar drift histórico e plano de migração do PR #26; sem aplicação de migrations em produção.
- Regra de consentimento para Meta/Ads precisa de revisão jurídica antes de ativar mudanças de tracking em produção.

**Segurança:** `ga4-transport.ts` continua retornando `DISABLED` incondicionalmente. Worker não agendado; PR #26 e dependentes permanecem em draft. Nenhum envio de refund é autorizado por esta fase.
