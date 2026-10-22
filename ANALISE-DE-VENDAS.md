# Análise de vendas no painel administrativo — proposta

**Estado:** proposta inicial. **Nenhuma funcionalidade implementada.**
**Decisão de produto (2026-10-22):** as análises de vendas serão desenvolvidas **dentro do painel administrativo da Divine Closet**, aproveitando os dados da própria loja. A integração com o Sistema-CRM e a ativação de um ERP externo ficam **adiadas** (ver `ERP-EVENTOS-PERSISTENTES.md` §8 e `PENDENCIAS.md`).
**Histórico calculado dos dados transacionais** (`Order`, `OrderItem`, `Refund`) — **não** depende de reconstruir a fila `ErpEvent`.

---

## 1. Objetivo e usuários

**Objetivo:** dar ao dono uma leitura confiável de **quanto vendeu, quanto recebeu e o que ficou de fora**, sem planilha e sem interpretação manual de status.

**Usuários:** exclusivamente perfis administrativos da loja (`ADMIN`; decidir se `OPERATOR` também — hoje `requireAuth("ADMIN")` já aceita `OPERATOR` e `MARKETING`, o que é amplo demais para dado financeiro).

**Não é o objetivo:** lucro contábil, DRE, custo de aquisição, estoque físico ou integração externa.

---

## 2. Fontes de dados atuais (o que existe de verdade)

Todas conferidas no schema (`packages/database/prisma/schema.prisma`):

| Fonte | Campos úteis | Observação |
|---|---|---|
| `Order` (`:275-328`) | `number`, `status` (7 estados), `paymentStatus` (4), `paymentMethod` (CARD/PIX/BOLETO), `paymentId`, `couponCode`, `subtotal`, `shipping`, `discount`, `total`, `createdAt`, `entregueEm`, `trackingCode`, `utm*`, `guestEmail/guestName`, `userId` | A base principal |
| `OrderItem` (`:374-389`) | `productName`, `productSlug`, `quantity`, `unitPrice`, `total`, `size`, `color` | **Snapshot** do produto no momento da compra — não muda se o catálogo mudar depois |
| `Refund` (`:329-357`) | `amount`, `status` (REQUESTED/IN_PROCESS/APPROVED/REJECTED), `mpRefundId`, `resolvedAt`, `requestedBy`, `idempotencyKey` | **1:1 com o pedido** (`orderId @unique`) → **estorno é integral apenas** |
| `Coupon` (`:433-448`) | `code`, `type` (PERCENT/FIXED/FREE_SHIPPING), `value`, `maxUses`, `usedCount`, `minSubtotal`, janela `startsAt/endsAt` | Para analisar desconto |
| `Product` / `OrderItem` | `productName` (snapshot), `size`, `color` | Para "produtos vendidos" |

**Não existe e seria preciso criar para o indicador:** estorno **parcial**, custo por pedido (só existe custo de produto na precificação, não ligado ao pedido), taxa de gateway por transação, e devolução física (RMA).

---

## 3. Indicadores previstos

> Cada indicador define **data usada**, **estados incluídos** e **tratamento de pedido de teste**.

| Indicador | Definição | Data usada | Estados incluídos | Pedido de teste |
|---|---|---|---|---|
| **Pedidos criados** | `COUNT(Order)` | `createdAt` | Todos **exceto** `deletedAt != null` | **Excluído** |
| **Pagamentos aprovados** | `COUNT(Order)` onde `paymentStatus = PAID` | `createdAt` do pedido | `paymentStatus = PAID` | **Excluído** |
| **Cancelamentos** | `COUNT(Order)` onde `status = CANCELLED` | `createdAt` | `status = CANCELLED` | **Excluído** |
| **Estornos** | `COUNT(Refund)` onde `status = APPROVED` | `Refund.resolvedAt` (**não** `createdAt` — evita contar pedidos ainda em análise) | `Refund.status = APPROVED` | **Excluído** |
| **Vendas brutas** | `SUM(OrderItem.total)` dos pedidos aprovados | `createdAt` do pedido | `paymentStatus = PAID` | **Excluído** |
| **Descontos concedidos** | `SUM(Order.discount)` dos pedidos aprovados | `createdAt` | `paymentStatus = PAID` | **Excluído** |
| **Frete cobrado** | `SUM(Order.shipping)` dos pedidos aprovados | `createdAt` | `paymentStatus = PAID` | **Excluído** |
| **Ticket médio** | `SUM(total) / COUNT(pedido)` sobre pedidos aprovados | `createdAt` | `paymentStatus = PAID` | **Excluído** |
| **Produtos vendidos** | `SUM(OrderItem.quantity)` agrupado por `productName`/`size`/`color` | `createdAt` | `paymentStatus = PAID` | **Excluído** |
| **Valor estornado** | `SUM(Refund.amount)` | `Refund.resolvedAt` | `Refund.status = APPROVED` | **Excluído** |

### Tratamento de pedido de teste (regra única)

Pedido de teste = `deletedAt IS NOT NULL`. **Exclusão obrigatória** em todos os indicadores — inclusive os de receita. Filtro fixo em uma única *view*/função de base, para nenhum indicador esquecer.

> Não usar `guestEmail` para heurística de teste (falso positivo em cliente real que não criou conta).

---

## 4. Valor vendido × valor recebido × resultado financeiro

**Três números distintos, nunca somados nem chamados de "lucro".**

| Conceito | Fórmula | O que responde |
|---|---|---|
| **Valor vendido** | `SUM(total)` dos pedidos com `paymentStatus = PAID` | "Quanto de venda eu fiz no período?" |
| **Valor recebido** | `Valor vendido − SUM(Refund.amount dos APPROVED)` | "Quanto disso não voltou?" |
| **Resultado financeiro** | **Não calculável hoje** | — |

**Por que não há "lucro":** não existe, por pedido, (a) custo da peça confiável ligado ao pedido, (b) taxa da operadora de pagamento, (c) despesas de embalagem/frete/tributos. Os custos de precificação existem no módulo de precificação (`LoteCompra`, `ConfigPrecificacao`), mas **não são congelados no `OrderItem`** — recalcular depois com o custo de hoje dá número errado.

**Enquanto não houver esses dados, o painel deve exibir "Resultado financeiro: indisponível" e jamais estimar.** O nome "lucro" é proibido na UI até existir custo + taxa + despesa confiáveis.

---

## 5. Estorno integral/parcial e múltiplas tentativas de pagamento

### Estorno

- O modelo **só suporta estorno integral**: `Refund.orderId @unique` (1:1) e a chamada ao Mercado Pago envia body `"{}"` sem `amount` (`lib/mercadopago.ts:235-253`).
- **Regra de contagem:** um pedido estornado conta **uma vez**, pelo `Refund.resolvedAt`, com `amount` integral.
- **Estorno parcial não existe** — se um dia for implementado, quebra o 1:1 e exige migração (`orderId` deixa de ser unique) e mudança da regra de `Valor recebido`.
- `Refund.status` em `REQUESTED`/`IN_PROCESS` **não** reduce `Valor recebido` (só `APPROVED`); deve aparecer separado como "estornos em andamento".

### Múltiplas tentativas de pagamento

Modelo real: `Order.paymentId` **não é unique**; um pedido pode acumular tentativas no Mercado Pago, mas **só um `paymentId` fica gravado** (o último, em `route.ts:378`/`finalizar.ts:133`).

**Regras:**
- Contar **pedidos**, nunca **transações do gateway** — não há tabela de tentativas, então "tentativas de pagamento" **não é um indicador derivável** hoje.
- Pedido recusado vira `status=CANCELLED, paymentStatus=FAILED` → entra em "cancelamentos", **não** em "pagamentos aprovados".
- **Pendência:** o defeito de cartão `in_process` tratado como recusa (ver `DIAGNOSTICO-FLUXO-COMPRA-VENDA.md` §7) pode gerar pedido `CANCELLED` com cobrança ativa. **Enquanto não corrigido, "cancelamentos" pode estar superestimado.** Registrar essa ressalva no painel.

---

## 6. Filtros previstos

| Filtro | Escopo | Nota |
|---|---|---|
| **Período** | `createdAt` do pedido (e `resolvedAt` para o recorte de estornos) | Seletor padrão: mês corrente / últimos 30 / 90 / personalizado |
| **Status** | `Order.status` (7 estados) | Incluir `REFUNDED` no filtro (hoje a UI admin o omite) |
| **Produto** | `OrderItem.productName` (snapshot) ou `productId` | Snapshot evita que renomear/apagar o produto mude o histórico |
| **Método de pagamento** | `Order.paymentMethod` (CARD/PIX/BOLETO) | Boleto só existe sem MP — refletir isso na UI |
| **Origem/convidado** | `userId IS NULL` (guest) vs logado | Derivável de `guestEmail`/`userId` |
| *(futuro)* cupom | `Order.couponCode` | Já gravado |

---

## 7. Permissões administrativas

- Acesso **somente** a `ADMIN`. **Não** expor a `OPERATOR`/`MARKETING` até decisão explícita — hoje `requireAuth("ADMIN")` os aceita, e dado de receita não deve herdar esse amplo.
- Nenhum valor de receita em página pública, API pública ou payload de e-mail.
- Exportação (CSV) restrita ao mesmo perfil e registrada em `AuditLog` (`schema.prisma:462`).

---

## 8. Lacunas de dados

| Lacuna | Impacto | Precisa de |
|---|---|---|
| Sem custo por pedido | Impede qualquer noção de resultado | Congelar custo no `OrderItem` no ato da compra |
| Sem taxa de gateway por transação | Impede resultado financeiro | Importação do extrato do MP ou campo no pedido |
| Sem estorno parcial | "Valor recebido" só aceita binário | Migração do `Refund` (1:1 → 1:N) |
| Sem tentativas de pagamento | Indicador de recusa/abandono não derivável | Tabela de tentativas |
| Sem status de entrega automático | "Entregues" depende do admin marcar manual | Integração com transportadora |
| Guest não gera avaliação/prova social | Perda de métrica de satisfação | Abrir avaliação para guest |
| Driver de e-mail e crons não comprovados | Métricas de comunicação não confiáveis | Conferência no painel Vercel |

---

## 9. Critérios de aceite (futura implementação)

1. Todos os indicadores excluem `deletedAt != null` (pedido de teste) por construção.
2. "Valor vendido", "Valor recebido" e "Resultado financeiro" são **três campos separados**; nenhum é rotulado "lucro".
3. Estorno conta pelo `resolvedAt` e só quando `APPROVED`; estornos `REQUESTED/IN_PROCESS` aparecem em bloco separado.
4. Nenhum indicador usa data de `Refund.createdAt` nem conta transações do gateway.
5. Filtros de período/status/produto/método refletem **todos** os números do painel de uma vez (sem divergência entre cartões).
6. Acesso restrito a `ADMIN`; teste automatizado negando acesso a `OPERATOR`/`MARKETING`/cliente.
7. Exportação CSV idêntica aos números exibidos.
8. Página de detalhe de pedido permanece acessível para o admin a partir do painel.
9. Suíte cobrindo: pedidos de teste excluídos, estorno só `APPROVED`, período por `createdAt` vs `resolvedAt`, e permissões.
10. Sem mudança de schema nas fases 1–2 (exceto, se aprovado, congelar custo no item).

---

## 10. Fases sugeridas

### Fase 1 — Consultas e indicadores básicos (sem schema)
- Leitura direta de `Order`/`OrderItem`/`Refund` com a regra de exclusão de teste.
- Cartões: pedidos criados, pagamentos aprovados, cancelamentos, estornos, vendas brutas, descontos, frete, ticket médio, produtos vendidos.
- Filtros de período e status.
- Blocos separados: valor vendido / valor recebido / estornos em andamento.
- **Nada de "lucro"** ainda.

### Fase 2 — Relatórios e exportação
- Filtros de produto, método de pagamento e guest/logado.
- Série temporal mensal.
- Exportação CSV (registrada em `AuditLog`).
- Detalhe de pedido acessível a partir do painel.

### Fase 3 — Só depois (requer decisão + schema)
- Congelar custo no `OrderItem` → habilitar "resultado financeiro" honesto.
- Estorno parcial (migração `Refund`).
- Taxa de gateway.
- Entrega automática / rastreio.

---

## Relacionados

- `DIAGNOSTICO-FLUXO-COMPRA-VENDA.md` — estado real do fluxo e defeitos que distorcem esses números.
- `ERP-EVENTOS-PERSISTENTES.md` §8 — decisão de adiar o ERP externo.
- `PENDENCIAS.md` — roadmap do dono.
