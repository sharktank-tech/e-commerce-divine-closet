# GA4.2 — Concorrência de revogação e inventário de retenção

**Status:** incremento experimental, PR dependente da cadeia #26 → #32 → #33. **Não autorizado em produção.**

## 1. Propósito

A fundação GA4.2 armazena intenções de refund em uma outbox. O estado `PROCESSING` indica que um worker já reivindicou o evento. Na implementação anterior, a revogação marcava como `SKIPPED` somente `PENDING` e `FAILED`, ignorando `PROCESSING`. Uma resposta tardia do worker poderia recolocar um evento revogado como `PENDING`, apesar do consentimento já revogado.

## 2. Regras implementadas

A revogação pelo endpoint de consentimento e a revogação interna por pedido:
- Executam em transação PostgreSQL, bloqueando linhas de `AnalyticsEvent` relevantes com `SELECT ... FOR UPDATE`, em ordem por ID, antes de transicionar status.
- Transicionam `PENDING` e `FAILED` para `SKIPPED`, limpando leases.
- Transicionam `PROCESSING` para `FAILED` com `lastError=consent_revoked_inflight_uncertain` e limpam o lease. **Não afirmar que foi SKIPPED**, pois a entrega poderia já ter ocorrido no futuro.
- Preservam `ACCEPTED` (evento previamente aceito); revogar não desfaz uma entrega externa passada.
- O enfileiramento também passou a ocorrer em uma transação: bloqueia **token de consentimento → identidade analítica** nessa ordem, relê consentimento e estado financeiro e só então cria o evento. Se a revogação vencer, não cria `PENDING`; se o enqueue vencer, a revogação vê e cancela a intenção. A colisão UNIQUE é tratada **após rollback** da transação, preservando a idempotência.
- O worker finaliza por atualização condicional `status=PROCESSING`. Se uma revogação vence a disputa, a atualização encontra `count=0` e retorna `CONFLICT`, nunca convertendo o evento de volta a `PENDING` ou assumindo `ACCEPTED`. Esses conflitos exigem observabilidade/revisão futura, sem reenvio automático.
- Não modificam o estado financeiro do pedido/reembolso, não chamam o Mercado Pago.

**Limite fundamental:** a transação não cria automaticamente uma preferência de revogação para futuros pedidos/dispositivos e não consegue impedir um INSERT de um código legado que ignore os locks e a nova rotina. Todas as vias de criação de intenções devem passar pelo boundary auditado.

**Limite de egress:** a transação protege estados *no banco*, **não** bloqueia nem revoga uma requisição HTTP externa já iniciada. A prova de serialização de envio para quando o transporte for implementado exige protocolo de egress próprio (fencing/lease compartilhado, revalidação e decisão sobre in-flight). Não usar estes testes como autorização para ligar o transporte. O arquivo `ga4-transport.ts` continua hard-off incondicionalmente.

### Matriz de interleaving

| Situação | Estado esperado após revogação | Envio automático |
|---|---|---|
| `PENDING` não reivindicado | `SKIPPED`, consentimento revogado | Bloqueado |
| `FAILED` anterior | `SKIPPED`, consentimento revogado | Bloqueado |
| `PROCESSING` com resposta pendente | `FAILED` + `consent_revoked_inflight_uncertain` | Bloqueado; revisão humana |
| Worker tenta finalizar depois da revogação | `CONFLICT` por CAS; persiste status revogado | Bloqueado |
| `ACCEPTED` anterior à revogação | Preserva status histórico | Não reenviar; não interpretar como exclusão no GA4 |

## 3. Teste de integração PostgreSQL (sem rede)

`apps/web/src/lib/__tests__/ga4-revocation-pg-real.test.ts` exige ambas as condições:
1. `GA4_CONCURRENCY_TEST_DB=true` explícito.
2. `DATABASE_URL` local, banco `divine_ga4_test` e porta 5432.

O CI prepara PostgreSQL descartável via serviço, migra o schema nele e habilita essa flag. O teste cria um pedido e reembolso **fictícios nesse banco isolado**, um evento `PENDING` e consentimento assinado de teste. Mocka `submitGa4Refund` com um bloqueio controlado, inicia o worker, revoga o cookie no endpoint enquanto o evento está `PROCESSING`, libera a conclusão simulada e prova que o CAS não reabre o evento. Outro teste disputa `enqueueGa4RefundIfAuthorized` com a revogação e prova que nenhum `PENDING` persiste depois da confirmação de recusa. Não chama serviços externos, não cria um pedido na loja real e remove os registros do banco de teste ao terminar.

## 4. Inventário de retenção — dry-run, sem deleção

`previewGa4Retention(cutoffs)` é uma função **interna e apenas leitura**, sem endpoint público, scheduler ou plano de exclusão.

Recebe datas de corte explícitas para:
- Consentimentos de navegador revogados/expirados.
- Identidades analíticas revogadas.
- Eventos `SKIPPED` e `ACCEPTED` antigos.
- Logs de auditoria especificamente de consentimento GA4.
- Em seção distinta, contabiliza `PROCESSING` e `FAILED` **sem considerá-los candidatos à exclusão**, por conterem incerteza operacional.

Retorna **somente contagens agregadas**; não expõe token, e-mail, client ID, order ID nem payload. Rejeita datas inválidas/futuras; não possui `deleteMany`, `updateMany` nem chamadas a provedores. Os períodos de retenção **não estão definidos nesta etapa**: devem ser aprovados por responsáveis jurídicos/privacidade e compliance, inclusive preservação legal, trilhas de auditoria, minimização e eventuais direitos do titular. Contagem de candidatos não equivale a autorização de descarte.

## 5. Bloqueios restantes antes de qualquer merge/ativação

1. Aprovar política de retenção, forma de anonimização/remoção, backup, auditoria e bloqueio legal; criar PR separado de descarte apenas após homologação.
2. Desenhar e testar serialização de entrega externa com revogação em processos/instâncias distintos, sem ignorar respostas incertas.
3. Garantir prova de posse para revogação guest e preferência permanente de conta para novos pedidos/dispositivos.
4. Fazer revisão de privacidade/consentimento de Meta e Ads, e reconciliação histórica entre `purchase` e `refund`.
5. Resolver diagnóstico de drift legado do Prisma. O workflow atual usa `continue-on-error` no `migrate diff`; verde não comprova ausência de drift.
6. Exigir auditoria de segurança, volume e incident response antes de agendar worker ou liberar credenciais.

**Sem merge, deploy, backfill ou migração em produção. Transporte refund continua hard-off.**
