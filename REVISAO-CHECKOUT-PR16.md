# Revisão executada do PR #16

Rodada de 23/10/2026 (America/Araguaina). Base de produção consultada no Git:
`1c79fa491bc20131b896369be98bd411a6aaa56c`. Head recebido:
`05b27105e6eb6382e5ac43593eff097d7d81987b`.
Este documento substitui a matriz de cobertura dos relatórios anteriores.
Nenhum teste usa credenciais de produção nem chama o Mercado Pago real.

## Falhas encontradas e correções

- **Identidade não era efetivamente validada:** o adaptador descartava valor/moeda,
  e o validador aceitava a ausência deles. Agora consulta e busca preservam esses
  campos, e todos os caminhos exigem referência exata, BRL e total igual em
  centavos. A reconciliação não aceita referência errada mesmo com ID conhecido.
- **Webhook antes do ID persistido:** a resposta consultada no provedor, com
  referência/valor/moeda exatos, pode confirmar o pedido ainda sem `paymentId`.
  Divergências ficam no banco (`REVISAO_FINANCEIRA`), visíveis no admin.
- **Idempotência ausente no frontend:** a tentativa agora envia uma chave estável,
  guardada em sessionStorage até resultado conhecido. O token do cartão fica só
  em memória. O backend exige chave no driver real e resolve replay antes de
  consultar carrinho/cupom; verifica posse e método. Hash de método, pagador,
  parcelas e bandeira impede alterar esses parâmetros num retry de pedido novo.
- **Tentativa legada sem hash e sem ID:** não cria cobrança novamente. Retorna
  `409 recupera:true`, preservando a consulta por referência na reconciliação.
  Não é possível reconstruir retroativamente os parâmetros da tentativa antiga.
- **Resposta tardia regredia aprovação:** gravações de pending/failed agora
  condicionam também o estado financeiro. Resposta HTTP reflete o estado
  financeiro persistido quando a aprovação venceu a corrida.
- **Ausência na busca confundida com ausência de cobrança:** busca vazia, erro
  ou idade local não cancelam nem liberam cupom. Só estado terminal explícito
  do provedor, após examinar as outras tentativas, permite cancelamento automático.
- **Busca escolhia só a primeira tentativa:** examina páginas e prioriza aprovação,
  depois tentativa ativa. Duas aprovações distintas geram retenção persistida;
  uma lista truncada/inválida falha sem cancelar o pedido. Não há estorno automático.
- **Liberação de cupom sem posse:** a CTE consome `couponReserved` no próprio
  pedido CANCELLED/FAILED e só então decrementa o cupom. Repetição/concorrência
  não libera a reserva de outro pedido. Pagamento aprovado conserva sua reserva.
- **Hold podia ser apagado fora da transação:** a liberação de estoque ocorre
  dentro da finalização travada. Hold financeiro não pode ser liberado pelo botão
  de estoque. Admin não marca pagamento manualmente nem cancela pedido pago;
  atualização comercial usa comparação do estado anterior para detectar corrida.
- **Resposta incompleta virava `"undefined"`:** adaptador e serviço rejeitam ID
  ausente em runtime, mantendo o pedido recuperável. `!` de TypeScript não é validação.
- **Crash entre venda e e-mail:** a linha do outbox passa a nascer na transação
  da confirmação. Transporte permanece pós-commit. Falha no outbox reverte os
  efeitos locais; o provedor pode já ter aprovado, então a próxima confirmação
  repete a transação com segurança.

## Cobertura real

Em `apps/web/src/lib/__tests__/checkout-integridade-pg.test.ts`, PostgreSQL nativo,
conexões Prisma independentes e rotas/serviços reais; apenas rede e transporte
externo são simulados. O enfileiramento de confirmação usa o outbox real.

| Cenário | Teste direto |
|---|---|
| Retomadas simultâneas após pedido persistido, antes da cobrança | `duas retomadas simultâneas antes da chamada` — duas chamadas HTTP, mesmo payload/chave, **uma cobrança efetiva** no provedor simulado |
| Provedor aceita e resposta se perde | `timeout APÓS aceitação` — primeiro POST falha, replay sem carrinho recupera a mesma cobrança |
| Webhook antes de persistir ID | `webhook na barreira antes de salvar paymentId` — webhook é executado dentro da barreira de criação |
| Recusa tardia após aprovação | `recusa tardia na criação` — PAID preservado |
| Busca vazia e aprovação posterior | `busca vazia mesmo após a janela` — não cancela; depois recupera ID nulo e baixa uma vez |
| Falha de transporte | `erro de transporte não é busca vazia` — mantém pedido recuperável |
| Duas aprovações encontradas | `duas aprovações distintas ficam em revisão persistida` — sem baixa/estorno |
| Aprovação após outra já confirmada | `segunda aprovação após finalização` — retenção, sem efeitos duplicados |
| Recusa antiga seguida de aprovação | `recusa antiga não esconde outra tentativa aprovada` |
| Resposta do provedor incompleta | `resposta sem id deixa estado recuperável` |
| Posse da chave de checkout | `chave de outra pessoa não revela pedido` |
| Mudança de parâmetros no retry | `retry não pode alterar os parâmetros` |
| Replay sob retenção financeira | `replay com retenção financeira nunca inicia outra cobrança` |
| Compatibilidade de tentativa legada | `tentativa legada sem hash/ID exige reconciliação` |
| Liberação única do cupom | `liberação concorrente/repetida` — não altera reserva alheia |
| Aprovação concorrente ao cancelamento | `aprovação concorrente com cancelamento` — mantém reserva se pago; se cancelamento vence, aprovação fica em revisão |
| Retenção e reprocessamento | `hold de estoque preserva reserva` — sem baixa parcial; comando explícito; repetição não duplica |
| Outbox atômico | `falha ao persistir outbox reverte status/estoque` — retry grava exatamente uma linha |
| Webhooks simultâneos do mesmo pagamento | `#3 duas notificações simultâneas` — estoque/cupom/ERP e **linha real do outbox** uma vez |

A ordem arbitrária da busca, rejeição de moeda/valor/referência ausentes ou
incorretos e resposta incompleta são testadas com adaptador/validador reais em
`mercadopago.test.ts`. `reconciliar-pix.test.ts` usa o validador real, não um mock
que sempre retorna sucesso. A corrida de retomada HTTP exercita **Pix**; cartão
é coberto pelos testes de adapter/serviço, não por uma transação de cartão ao vivo.

## Validação desta entrega

- Suíte: **53 arquivos / 548 testes**, sem falhas nem skips.
- Typecheck e lint: zero erros; warnings de `<img>` já existentes.
- Build Next.js: aprovado com banco local migrado.
- PostgreSQL nativo **16.15**, com sessões concorrentes independentes. A suíte
  de reconstrução existente também contém testes com PGlite; eles não são a
  evidência de concorrência desta rodada.
- `upgrade-checkout-pg.mjs`: **28 → 31 migrações**, três pedidos sintéticos
  PENDING/PAID/REFUNDED + um Refund APPROVED e cupom com contador preservados.
- Nenhuma migração anterior foi alterada; o script compara cada SQL da base
  antes de executar. A alegação anterior de “25 migrações” estava incorreta.
- As migrações foram aplicadas **somente em bancos locais descartáveis**.
  Não foi consultado `_prisma_migrations` de produção nesta rodada.

Reprodução com um PostgreSQL nativo local e `psql` no PATH:

```bash
npm ci
export PGHOST=127.0.0.1 PGPORT=5444 PGUSER=postgres
export DATABASE_URL=postgresql://postgres@127.0.0.1:5444/postgres
npm run test
node packages/database/scripts/upgrade-checkout-pg.mjs
npm run typecheck
npm run lint
# Para build: usar um banco LOCAL já migrado com npm run prisma:deploy.
npm run build
```

No ambiente Alpine do agente, o provisionamento versionado continua sendo
`node packages/database/scripts/pg-real.mjs setup` seguido de
`eval "$(node packages/database/scripts/pg-real.mjs env)"`; não presumir 5444
se o script exportar outra porta. Neste host Ubuntu, foram usados binários PG16
extraídos em diretório descartável, com bibliotecas locais e um shim de UID/stat
apenas para permitir iniciar o banco no sandbox que apresenta UID 0. O motor SQL,
processos e locks são nativos; binários, shim e dados não entram no Git.

## Publicação futura e recuperação — não executadas

1. Confirmar head remoto, estado dos checks e que o diff de migrações contra
   `main` contém **somente adições**. Não presumir que “já aplicada” signifique
   produção: confirmar o ambiente e o histórico real antes de qualquer deploy.
2. Preparar backup de produção e teste de restauração sob autorização de
   publicação. Verificar pedidos pendentes, pagos, retidos e reservas de cupom.
3. Aplicar, nesta ordem, somente as migrações pendentes:
   - `20261022090000_order_idempotency_key`;
   - `20261022110000_order_hold_cupom_reserva`;
   - `20261024010000_order_payment_request_hash`.
   Usar conexão de migração apropriada, nunca inferir pelo pooler da aplicação.
4. Publicar código após schema aditivo. `idempotencyKey`/`paymentRequestHash`
   nulos e `couponReserved=false` preservam pedidos anteriores. Finalização de
   cupom legado continua protegida e não reconta uma reserva já existente.
5. Smoke de leitura/autorização não deve disparar cobranças, notificações de
   produção simuladas, drenos ou backfills. Conferir retenções no detalhe admin.
6. Se surgir defeito, interromper **novos** checkouts pelas formas de pagamento
   da configuração administrativa e confirmar o bloqueio. Replays existentes,
   webhook e reconciliação precisam continuar acessíveis para pagamentos em voo.
7. Preferir correção forward. Um revert integral ao `main` anterior remove as
   guardas de idempotência, reserva e hold: **não é rollback seguro** com pedidos
   criados pelo código novo. Preparar release de recuperação que mantenha esses
   caminhos e só reverta a parte defeituosa. Não executar revert automático.
8. Nunca remover colunas, apagar chaves, zerar contadores, limpar holds ou
   regravar estados financeiros para “compatibilizar” código antigo. Manter
   histórico de Order/Refund/outbox e investigar divergências no provedor.

## Limites e operação

Sem merge, deploy de produção, banco/configuração de produção, cobrança, estorno,
envio real, backfill ou dreno. Push pode gerar **preview automático** na Vercel.
O pedido real 7653 não foi usado como fixture nem consultado ou modificado.

Validação local não comprova entrega real de webhook/cron no ambiente publicado.
Homologação externa só após autorização de publicação e sem repetir o estorno.
Casos financeiros ambíguos permanecem sob decisão humana; não foi criado um botão
para liberar automaticamente `REVISAO_FINANCEIRA`. Reposição após estorno e
política de devolução física continuam fora desta correção.
