# Diagnóstico do fluxo de compra e venda

> ## ⚠️ OS 4 P0 FORAM CORRIGIDOS — ver "Aplicação das correções" (§11)
> Este documento descreve o estado de `main` **em 2026-10-21**. Os quatro
> defeitos P0 listados em §10 (cartão `in_process`, idempotência de criação,
> idempotência de webhook, estoque negativo) e os P1 de cupom `maxUses` e de
> `REFUNDED` manual **já estão corrigidos** na correção de integridade do
> checkout. As seções abaixo foram mantidas como REGISTRO do defeito (com o
> `arquivo:linha` de então); o estado atual está em §11, com os novos
> `arquivo:linha` e os testes que os cobrem.

**SHA analisado:** `1c79fa491bc20131b896369be98bd411a6aaa56c` (`main`, tree `908a86a7797df0156c67284c6c1c6765d170d6b6`, merge do PR #14, 2026-10-21).
**Escopo:** leitura de código em `main`. Nenhuma alteração funcional, migração, cobrança, estorno, envio, backfill ou dreno de fila.
**Evidência de produção:** limitada — ver "Limitações desta rodada". Os fatos operacionais abaixo são os já homologados pelo dono e citados em §Evidências.

## Classificações usadas

| Classe | Significado |
|---|---|
| **Implementado e validado** | Comportamento existe e tem validação automatizada **e/ou** comprovação operacional |
| **Implementado, com validação operacional pendente** | Código existe e é coerente; falta confirmação em produção (logs/painel) |
| **Parcial ou manual** | Existe, mas com lacuna, regra manual ou dependência de ação humana |
| **Ausente** | Não existe no código |
| **Bloqueado por defeito confirmado** | Existe, mas com defeito verificado por leitura direta do código |

> Regra de honestidade: **HTTP 200, build aprovado ou existência de função não comprovam etapa.** Cada classe abaixo cita `arquivo:linha`.

---

## Evidências de operação já relatadas (conferidas quando possível)

| Fato | Situação nesta rodada |
|---|---|
| Pedido `DC-20261017-7653`: pagamento real + **estorno integral concluído** (`Refund.status=APPROVED`, `amount=32.99`, `resolvedAt=2026-10-17T18:34:54.611Z`, `mpRefundId` presente) | **Confirmado em rodada anterior** (consulta somente-leitura). Não repetido. **Correção de ênfase:** o 7653 prova que o caminho de **pagamento + estorno** funciona com pagamento real — ele **não** valida o ramo do cartão. O defeito de cartão `in_process` (§7) foi e continua sendo confirmado **por leitura direta do código** (a classe "defeito confirmado" significa exatamente isso, ver "Classificações usadas"); nenhuma transação de cartão em análise foi observada ao vivo. |
| Pedido `DC-20261017-8422`: cancelamento + **recebimento do e-mail** | **Relato do usuário**. Não repetido. |
| **Resend** configurado no painel | **Conferência manual do usuário**. Driver efetivo (`EMAIL_DRIVER`) e credenciais **não** verificáveis por mim (sem painel Vercel). |
| Execução dos **crons** | **Sem comprovação por logs** — fila de e-mails/ERP não muda ≠ crons rodando. |
| **ERP sem destino** (`ERP_WEBHOOK_URL`/`SECRET` ausentes) | **Confirmado** (fila com evento `PENDING`, sem envio). Agora **adiado por decisão de produto** — ver `ERP-EVENTOS-PERSISTENTES.md` §8. |
| Acesso à base de produção | **Indisponível nesta sessão** (sem `DATABASE_URL` de produção no ambiente). Números de pedidos/estoque **não** reportados. |

---

## 1. Catálogo

| Item | Achado |
|---|---|
| Publicação | `isActive: true, deletedAt: null` nas listagens públicas (`api/produtos/route.ts:34-36`, PDP `produtos/[slug]/page.tsx:26`, `sitemap.ts:29`). Soft delete **respeitado na vitrine**. |
| Variantes | `ProductVariation(productId,size,color,stock,sku)` única por combinação (`schema.prisma:183-195`). Admin sincroniza `product.stock = soma das variações` (`api/admin/produtos/route.ts:104,151`; `[id]/route.ts:205-206`). |
| Preço | `price`, `comparePrice`, `discountPercent`. Badge de desconto na PDP é **calculado** de `comparePrice` vs `price` (`produtos/[slug]/page.tsx:157-165`), enquanto filtro/ordenação usam o campo `discountPercent` (`api/produtos/route.ts:50,58-59`) — **podem divergir** se o admin não sincronizar. |
| Disponibilidade | Tamanho/cor esgotados ficam `disabled` (`components/loja/AddToCart.tsx:177-230`). Quantidade exata só exibida quando baixa (≤5) ou esgotado (`lib/produto-publico.ts:106-111`). |
| Estoque na vitrine | **Sem reserva**. `CartItem` guarda só `quantity` + snapshot `unitPrice` (`schema.prisma:229-242`). |
| Cache | PDP com `revalidate = 60` (`produtos/[slug]/page.tsx:21`) — preço/estoque até 60s defasados (mitigado pelas validações do servidor ao adicionar). |

**Classificação:** **Implementado e validado** (vitrine/PDP/variantes).
**Risco no código:** filtro `estoque=1` usa só `product.stock` (`api/produtos/route.ts:49`), ignorando variações — produto com estoque total positivo mas variação esgotada aparece como disponível.

---

## 2. Carrinho

| Item | Achado |
|---|---|
| Identidade | Cookie `dc_guest` httpOnly 30d para convidado; carrinho por `userId` quando logado (`api/carrinho/route.ts:8-37`). |
| Operações | `POST` inclui (zod `quantity 1..99`), `PATCH` altera/remove, `DELETE ?itemId` escopado ao cart (`route.ts:40-45,228-254`). |
| Persistência de preço | **Snapshot** `unitPrice` na inclusão (`route.ts:185`); `lib/carrinho-revalidacao.ts:13-38` compara snapshot vs preço atual e **bloqueia o checkout** até o cliente resolver (`checkout/page.tsx:1235`; `PATCH {aceitarPreco:true}` regrava, `route.ts:217-226`). |
| Cobrança | O valor cobrado vem **sempre do preço atual do banco**, não do snapshot (`api/pedidos/route.ts:200-204,294-295`) — snapshot é só o guardião de aviso. |

**Classificação:** **Implementado e validado** (adição/alteração/remoção/revalidação de preço).
**Defeitos no código:**
- **`deletedAt` não é checado ao exibir nem ao criar pedido**: `GET /api/carrinho` e `POST /api/pedidos` filtram só `isActive` (`api/carrinho/route.ts:95`; `api/pedidos/route.ts:135,155`) → **produto soft-deletado com `isActive=true` é comprável**.
- `PATCH` de quantidade não valida estoque nem inteiro (`route.ts:231-234`): `99` aceito com estoque 1; `2.5` passa no `typeof` e estoura 500 no Prisma.
- `POST` soma acima de `product.stock` em produto sem variação (`route.ts:127` valida só o incremento; `:173` soma cega).
- `GET` ignora estoque de variação (`route.ts:96`) — aviso "insuficiente" não aparece; bloqueio só no submit (409).
- **Sem merge convidado+logado**: `escolherCarrinho` compra só o primeiro carrinho com itens (`lib/pedidos/selecionar-carrinho.ts:9-14`); o outro fica órfão.
- `Cart.couponCode` nunca é gravado (só existe no estado React) — **refresh da página perde o cupom**.

---

## 3. Endereço

| Item | Achado |
|---|---|
| Número opcional | `z.string().optional().transform(v => v || "s/n")` (`lib/validacao.ts:120-134`); gravado normalizado (`api/enderecos/route.ts:45-46`); UI confirma "Opcional" (`checkout/page.tsx:877`). |
| Salvamento/padrão | POST deduplica; primeiro vira padrão; `definirPadrao` atômico com lock na linha do usuário (`api/enderecos/route.ts:56-88`; `lib/enderecos.ts:36-50`). |
| Seleção no checkout | Ordem: escolha guardada → padrão → único → exigir seleção (`lib/checkout/enderecos-checkout.ts:61-74`). |
| Visitante | `POST /api/pedidos` aceita sem sessão com `guest.email` (`api/pedidos/route.ts:104-112`); endereço inline com `userId: null` (`lib/pedidos/endereco-pedido.ts:51-63`); `addressId` alheio → 400 sem vazar (`route.ts:446-448`). |

**Classificação:** **Implementado e validado**.
**Defeito no código:** `Order` guarda só `addressId` (`schema.prisma:282-283`) e o `DELETE` do endereço é **hard delete** (`api/enderecos/[id]/route.ts:70`), sem `onDelete` declarado → o GET de pedidos faz `include: {address:true}` (`api/pedidos/route.ts:79`) → **excluir um endereço usado destrói o endereço de entrega dos pedidos históricos**.

---

## 4. Frete

| Item | Achado |
|---|---|
| Cálculo | **Simulado, sem transportadora externa**: valor fixo com isenção acima de `freeFrom` (`lib/pedidos/calculo-total.ts:53-62`); o CEP só define prazo por 1º dígito (`lib/frete.ts:13-18`). `TODO-CLIENTE: substituir por API real` (`api/frete/route.ts:9`; `api/pedidos/route.ts:248`). |
| Recálculo | Efeito no checkout dispara em `cep|subtotal|cupom`; dedupe em voo e descarte de resposta antiga (`checkout/page.tsx:386-455`); falha bloqueia envio (`total === null`, `:1235`); retry manual por botão. |
| **Validação no servidor** | **Correta e forte**: o body do checkout **não envia `shipping`** (`checkout/page.tsx:609-635`); `POST /api/pedidos` recalcula tudo do banco (`api/pedidos/route.ts:200-204,243-247`). O valor exibido e o cobrado vêm do **mesmo pipeline** (`lib/frete.ts:9-10`). |

**Classificação:** **Parcial ou manual** — a mecânica (recálculo + validação servidor) é **Implementado e validado**, mas o **valor do frete é flat** (mesmo para todo o Brasil), reconhecido como pendência pelo próprio código.
**Não há serviço externo**, logo não há falha de terceiro a tratar hoje.

---

## 5. Cupom

| Item | Achado |
|---|---|
| Elegibilidade | Função pura única: inativo, janela de tempo, `usedCount >= maxUses`, `minSubtotal` (`lib/elegibilidade-cupom.ts:29-53`). |
| Revalidação no servidor | `POST /api/pedidos` relê o cupom e revalida com o **subtotal calculado no servidor** (`api/pedidos/route.ts:200-204,231-241`). O valor do `/api/cupom` é só exibição. |
| Cálculo | `PERCENT`, `FIXED` (limitado ao subtotal), `FREE_SHIPPING` (`lib/pedidos/calculo-total.ts:36-70`). |
| Consumo | `usedCount + 1` na **finalização do pagamento** (`lib/pedidos/finalizar.ts:137-141`), protegido pela guarda de já-finalizado. |

**Classificação:** **Bloqueado por defeito confirmado** (limite de uso).
**Defeitos confirmados por leitura direta:**
1. **`maxUses` é ultrapassável** — a elegibilidade é checada na **criação** do pedido (`api/pedidos/route.ts:236-239`), mas o consumo é na **confirmação** e o incremento é **incondicional** (`finalizar.ts:137-141`: `data: { usedCount: { increment: 1 } }`, sem `WHERE usedCount < maxUses`). Dois checkouts simultâneos com `maxUses=1` → `usedCount=2`. Em **Pix** é pior: não há reserva na criação, então vários pedidos `PENDING` usam o mesmo cupom de uso único antes de qualquer confirmação.
2. **`PERCENT` sem teto** — admin aceita `value >= 0` sem `.max(100)` (`api/admin/cupons/route.ts:9`) e o cálculo não limita (`calculo-total.ts:36-42`); cupom de 150% grava `Order.discount > Order.subtotal` e o cliente paga só o frete.
3. **PATCH admin sem zod** (`api/admin/cupons/[id]/route.ts:14-20`) — `value` negativo **aumentaria** o total (`calculo-total.ts:69`).

---

## 6. Checkout

| Item | Achado |
|---|---|
| Validações | Revalida preço/disponibilidade (`api/pedidos/route.ts:153-168`), estoque de produto (`:170-176`) e de variação (`:177-197`) antes de criar. Cupom e frete recalculados no servidor. |
| Criação do pedido | `tx.order.create` com `subtotal/shipping/discount/total` calculados (`:266-300`) + evento ERP `pedido_criado` na mesma tx (`:304-322`); entrega pós-commit (`:329-333`). |
| Preservação dos dados | Em falha de gateway, o **carrinho é preservado** (retorno antecipado antes do `deleteMany`, `:368-370`). Em recusa de pagamento (402), o carrinho **é apagado** (`:418`). |

**Classificação:** **Bloqueado por defeito confirmado** (idempotência).
**Defeitos confirmados:**
- **Sem idempotência de criação** — `checkoutSchema` não tem chave (`api/pedidos/route.ts:28-70`); `Order` só tem unique em `number` (`schema.prisma:277`). A única proteção é o botão `disabled` **client-side** (`checkout/page.tsx:1235`). Erro de rede no meio → retry **cria um 2º pedido e uma 2ª cobrança** (`X-Idempotency-Key` do MP é UUID **novo por request**, `lib/mercadopago.ts:36-38`).
- **Colisão de `orderNumber()`** (≈9000 combinações/dia, `lib/utils.ts:25-30`) viola `@unique` → P2002 não tratado → **500 genérico** (`api/pedidos/route.ts:443-458`).
- Pedido é criado **antes** do pagamento (`:266` vs `:337`); se o gateway estiver fora, cada tentativa deixa um `CANCELLED` órfão + 2 eventos ERP (`:347-371`).

---

## 7. Pagamento

| Item | Achado |
|---|---|
| Métodos | Enum `CARD/PIX/BOLETO` (`schema.prisma:34-38`). Com Mercado Pago ativo: **só Cartão e Pix** (boleto some da UI, `checkout/page.tsx:154-158`, e é barrado na API `api/pedidos/route.ts:216-223`). Sem MP: os três, com boleto "aprovado" automaticamente no sandbox (`lib/pagamento.ts:134-142`). |
| Integração | **In-Process payments** (Checkout Transparente): `POST /v1/payments` via fetch puro (`lib/mercadopago.ts:134-153`), sem `create_preference`. Tokenização no front (`checkout/page.tsx:548-556`). |
| Aprovação síncrona | Cartão aprovado → `finalizarPedidoPago` (`api/pedidos/route.ts:380-381`). |
| Pendência (Pix) | `status: "PENDING"` + QR; `paymentId` gravado (`route.ts:376-379`); **sem polling** no front. Expiração **não** pedida ao MP (`date_of_expiration` ausente, `mercadopago.ts:84-92`); só regra local de 48h (`lib/reconciliar-pix.ts:16,33`). |
| Recusa | Pedido `CANCELLED`/`FAILED` + 402 (`route.ts:385-405,439-442`). |

**Classificação:** **Bloqueado por defeito confirmado** (cartão em análise).
**Defeito confirmado:** o ramo do cartão aceita **apenas** `PAID`:
```ts
// lib/pagamento.ts:109-113
const estado = mapearStatusMp(pag.status);
if (estado === "PAID") return { success: true, ... };
return { success: false, paymentId: pag.id, status: "FAILED", ... };
```
`pending|in_process` (análise antifraude, comum em cartão) vira **recusa** → pedido **cancelado** (`api/pedidos/route.ts:385-393`). Quando o MP aprovar depois, o webhook descarta (`webhook/route.ts:82-84`) e a reconciliação **não cobre cartão** (filtro só PIX, `reconciliar-pix.ts:74`) → **cliente cobrado, pedido CANCELLED, sem estorno**.

---

## 8. Confirmação (webhook e reconciliação)

| Item | Achado |
|---|---|
| Endpoint | `POST /api/pagamentos/webhook` (`webhook/route.ts:16`). |
| Assinatura | **Opcional**: só valida se `MP_WEBHOOK_SECRET` existir; sem o segredo, apenas `console.warn` e segue (`webhook/route.ts:42-56`). HMAC em si está correto (`timingSafeEqual`, `mercadopago.ts:184-202`). |
| Rate limit | **Ausente** no webhook (só existe em login/contato/upload/reenvio). |
| Duplicatas | Guarda `paymentStatus !== "PENDING"` lida **fora** da transação (`lib/pedidos/finalizar.ts:94`), e dentro dela o `order.update` é **incondicional** (`:128-135`). O único lock é `SELECT ... FOR UPDATE` em `Product` (`:102-105`) — **não trava o pedido**. `enfileirarEvento` usa `skipDuplicates` e devolve o id **sem lançar** (`lib/erp.ts:239-262`), então a 2ª tx **não sofre rollback**. |
| Reconciliação Pix | Roda no cron diário de carrinho-abandonado (`api/cron/carrinho-abandonado/route.ts:27-34`, `0 12 * * *` UTC). Filtro: `PENDING` + `PIX` + `paymentId != null` + `>5min`, **`take: 30`** (`lib/reconciliar-pix.ts:69-82`). Cancela Pix expirado só com `>=48h` (`:24-37`), com guarda condicional correta no cancelamento (`:101-105`). |

**Classificação:** **Bloqueado por defeito confirmado** (idempotência de webhook).
**Defeito confirmado:** duas notificações concorrentes de "aprovado" (retry do MP por resposta lenta, ou webhook + reconciliação) passam ambas pela guarda (lida fora da tx) e executam a finalização duas vezes → **baixa de estoque duplicada** (`finalizar.ts:146-149,160-163`) e **`coupon.usedCount` +2** (`:137-143`). Só o e-mail (`dedupeKey`) e o evento `pedido_pago` (`businessKey`) são idempotentes.
**Outros:** webhook sem rate-limit; IPN legado (`?topic=payment`) é ignorado silenciosamente (`webhook/route.ts:26-30`).

---

## 9. Estoque

| Item | Achado |
|---|---|
| Baixa | **Único ponto**: `lib/pedidos/finalizar.ts:146-149` (produto) e `:160-163` (variação), ambos `stock: { decrement }`. Chamado por: pagamento síncrono (`api/pedidos/route.ts:381`), webhook (`webhook/route.ts:86`) e reconciliação (`reconciliar-pix.ts:93`). |
| Momento | **No pagamento aprovado**, nunca na criação do pedido (que só valida, `api/pedidos/route.ts:170-198`). |
| Reserva | **Não existe.** |
| Liberação/reposição | **Não existe** — `rg "stock: { increment|restaurarEstoque"` → **0 resultados** no repositório inteiro. |
| Concorrência | `decrement` do Prisma é uma `UPDATE` atômica, porém **sem `WHERE stock >= n`** e **sem `CHECK (stock >= 0)`** nas migrations. `FOR UPDATE` só em `Product` (`finalizar.ts:102-105`); `ProductVariation` e `Order` **não são travados**. |

**Classificação:** **Bloqueado por defeito confirmado** (perda e negatividade).
**Defeitos confirmados por leitura direta:**
1. **Perda definitiva de estoque** — pedido `PAID` (baixa já feita) que depois é cancelado ou estornado **não devolve as unidades** (nenhum `increment` existe). Cancelamento admin (`api/admin/pedidos/[id]/route.ts:80-127`), estorno (`lib/estorno.ts:97-109`) e reconciliação (`reconciliar-pix.ts:101-121`) não tocam estoque. O comentário em `estorno.ts:17-18` afirma que "cancelamento devolve" — **contradiz o código**.
2. **Estoque pode ficar NEGATIVO** — `finalizar.ts:107-114` lê `prod.stock` **uma vez** e compara item a item no loop, sem somar as linhas do mesmo produto. `CartItem` é único por `(cartId,productId,size,color)` (`schema.prisma:241`), então o mesmo produto pode aparecer 2x (tamanhos diferentes). Cenário: `stock=5`, carrinho `M×4` + `L×4` → todas as checagens passam (`5>=4` duas vezes) → `5 → 1 → -3`.

---

## 10. Administração

| Item | Achado |
|---|---|
| Localização | Lista filtra **só por `status`** (`api/admin/pedidos/route.ts:11-15`); detalhe por **UUID** (`[id]/route.ts:33-50`). **Não existe busca por número do pedido**. UI omite `REFUNDED` do filtro (`admin/pedidos/page.tsx:19`). |
| Ações | `PATCH` altera `status`, `paymentStatus`, rastreio (`[id]/route.ts:57-144`). Estorno em rota dedicada (`.../estornar`). |
| Máquina de estados | **Não existe.** O `tx.order.update` grava `status` direto do input (`[id]/route.ts:81-102`) sem validar de→para. A ausência de guarda está **documentada no próprio teste** (`lib/__tests__/concorrencia-erp.test.ts:145-148`). |
| Permissões | `requireAuth("ADMIN")` aceita ADMIN, **OPERATOR e MARKETING** (`lib/auth.ts:107-117`) — inclui estorno e alteração financeira. |

**Classificação:** **Bloqueado por defeito confirmado** (sem guard).
**Defeitos confirmados:**
- Qualquer transição é legal (`DELIVERED→PENDING`, `CANCELLED→SHIPPED`, etc.).
- **`status: "REFUNDED"` é setável à mão** pelo PATCH comum, **sem `Refund` e sem confirmação do MP** (`[id]/route.ts:14-22`), quebrando o invariante documentado em `schema.prisma:324-328` ("o pedido só vira REFUNDED após APPROVED"). O teste prevê esse caminho (`__tests__/admin-pedidos-patch.test.ts:72-80`).
- Cancelar um pedido **pago** não cria estorno nem altera `paymentStatus` (fica `status=CANCELLED` + `paymentStatus=PAID`).

---

## 11. Entrega

| Item | Achado |
|---|---|
| Registro | Admin PATCH grava `trackingCode/Carrier/Url` (`[id]/route.ts:86-94`); URL validada por allowlist de transportadoras (Correios/Jadlog/Loggi/Melhor Envio/Azul) com HTTPS e sem credenciais (`lib/rastreio.ts:23-53`). |
| E-mail de rastreio | Inclui código, transportadora e link (`lib/pedidos/notificar-status.ts:110-119`; `lib/email.ts:211-243`). |
| Comprador logado | `/conta` exibe código + "Acompanhar entrega" (`conta/page.tsx:271-299`). |
| Guest | `OrderTrackToken` (só SHA-256 no banco, 1 token por pedido, TTL 30d) — `schema.prisma:358-372`; geração idempotente (`lib/pedidos/acompanhar.ts:136-147`); **rotação sobrescreve o hash** (`:108-133`); reenvio com rate-limit por IP (10/h) e por pedido (máx 5 envios, espera 10min) (`api/acompanhar/reenviar/route.ts:18-47`). |

**Classificação:** **Implementado, com validação operacional pendente** (código completo; não comprovado em produção nesta rodada).
**Defeitos no código:**
- **Rotação antes do envio, envio direto sem outbox**: `processarReenvio` rotaciona (`acompanhar.ts:188-194`) e só depois `sendEmail(...).catch(log)` (`reenviar/route.ts:35-39`) → se o envio falhar, **o link antigo morreu e o novo nunca chegou**.
- `sendCount >= 5` é **vitalício** e bloqueia o reenvio de **todos** os pedidos daquele e-mail (`acompanhar.ts:51,183`).

---

## 12. Cancelamento e estorno

| Item | Achado |
|---|---|
| Comercial × financeiro | **Bem separados no modelo**: `CANCELLED` (comercial) nasce de 3 caminhos (admin PATCH, recusa no checkout, reconciliação Pix); `REFUNDED` (financeiro) nasce **só** do fluxo `Refund` (`lib/estorno.ts`). |
| Estorno | **Integral apenas**: body `"{}"` sem `amount` (`lib/mercadopago.ts:235-253`); schema 1:1 (`Refund.orderId @unique`, `schema.prisma:329-348`, comentário "Estorno integral"); UI só oferece "estorno integral" (`admin/pedidos/[id]/page.tsx:366`). **Não há estorno parcial em lugar nenhum.** |
| Guarda do REFUNDED | No fluxo de estorno, **correto**: transição só após `refund.status === "approved"` (`estorno.ts:212-244`) ou webhook `refunded` (`webhook/route.ts:66-72`); `paymentStatus` exige `PAID` via `updateMany` condicional (`estorno.ts:96-100`). |
| Idempotência | **Forte**: `Refund.idempotencyKey @unique` (`schema.prisma:338`) + `X-Idempotency-Key` ao MP (`mercadopago.ts:248`); corrida no create → 409 (`estorno.ts:373-382`); ERP com `businessKey` única; e-mail com `dedupeKey`. |
| Estoque | **Não devolve** (ver §9). |

**Classificação:** **Parcial ou manual** — o fluxo de estorno é **Implementado e validado** e idempotente (o 7653 prova o caminho feliz), mas o **cancelamento comercial não devolve estoque**, o admin pode **forçar `REFUNDED` sem confirmação**, e o estorno **parcial não existe**.
**Borda:** em `transicionarEstornoComEvento`, o `updateMany` de `status→REFUNDED` roda **antes** do `if (!mudou) return` (`estorno.ts:101-105`) — se `paymentStatus` já era REFUNDED mas `status` ainda era PENDING/PAID/PROCESSING, o status muda **sem evento ERP nem e-mail**.

---

## 13. Comunicação

| Item | Achado |
|---|---|
| Templates | Confirmação de pagamento, status (pago/preparo/enviado/entregue/cancelado/estornado + rastreio), links guest, convite de avaliação, redefinição de senha, carrinho abandonado, boas-vindas (`lib/email.ts:164-357`). |
| Outbox | `EmailOutbox` com `dedupeKey` único, `attempt`, backoff exponencial (cap 60min), máx 6 tentativas, `SENT` só após aceite do provedor (`lib/email-outbox.ts:34,60-70,193-223`). |
| Drivers | `mock` (nunca marca SENT), `smtp` (sem idempotency-key — repetição pode duplicar), `resend` (com Idempotency-Key e classificação transitório/definitivo) (`lib/email.ts:37-155`). |
| Drenagem | Crons diários (`0 12` e `0 21` UTC). |

**Classificação:** **Implementado, com validação operacional pendente** — a infraestrutura é sólida e o 8422 prova o caminho feliz, mas o **driver efetivo em produção** não é verificável sem o painel, e os **crons não têm comprovação por logs**.
**Defeitos:**
- Dois fluxos enviam **direto via `sendEmail`, sem outbox/retry**: reenvio de link guest (`reenviar/route.ts:36-39`) e carrinho abandonado (`api/cron/carrinho-abandonado/route.ts:96`).
- O cancelamento por **exceção de gateway** ("Falha na comunicação com o gateway") cancela **sem e-mail** — só evento ERP (`api/pedidos/route.ts:347-366`).

---

## 14. Pós-venda

| Item | Achado |
|---|---|
| Conta do cliente | `/conta` lista pedidos com badges, itens e rastreamento (`conta/page.tsx:240-305`). LGPD export/delete (`:339-389`). |
| Guest | `/acompanhar` (reenvio) e `/acompanhar/[token]` (detalhe público só com dados públicos, `acompanhar.ts:72-99`). |
| Avaliações | Criação exige sessão + pedido próprio pago/entregue (`api/avaliacoes/route.ts:112-151`); fotos (máx 3); moderação admin; convite 7 dias após entrega via cron `0 13 * * *` UTC (`api/cron/avaliacoes/route.ts:20-96`). |
| Atendimento | Botão flutuante WhatsApp + `/contato` (`components/loja/WhatsAppButton.tsx:8-38`) — **link genérico, sem contexto do pedido**. |

**Classificação:** **Parcial ou manual**.
**Lacunas:**
- **Sem página de detalhe de pedido** na conta; **sem exibição de estorno** para o cliente; **sem autoatendimento** de cancelamento/estorno.
- **Compradores guest nunca são convidados nem podem avaliar** — cron filtra `userId: { not: null }` (`api/cron/avaliacoes/route.ts:35`) e o POST exige `order.userId === session.sub` (`api/avaliacoes/route.ts:127-129`).
- WhatsApp sem contexto do pedido.

---

## Recuperação de pagamentos pendentes e indisponibilidade

| Cenário | Comportamento |
|---|---|
| **MP fora do ar no checkout** | O pedido **é criado mesmo assim** (`api/pedidos/route.ts:266`), depois o `processPayment` falha → `PaymentError` → pedido `CANCELLED` + 502 (`:347-371`). Cada tentativa deixa um **`CANCELLED` órfão** (+2 eventos ERP). O **carrinho é preservado**. |
| **Pix pendente** | Reconciliação diária (`0 12` UTC), **máx 30 por execução** (`reconciliar-pix.ts:80`). Aprovado → finaliza; expirado/rejeitado → cancela; `pending` → cancela só com `>=48h`. |
| **Cartão/boleto pendente** | **Nunca reconciliado** — o filtro é `paymentMethod: "PIX"` (`reconciliar-pix.ts:74`). |
| **Pagamento aprovado + estoque insuficiente** | `finalizarPedidoPago` lança (`finalizar.ts:114-115`) → webhook retorna **500 em loop**; reconciliação só conta erro (`reconciliar-pix.ts:140-144`). **Pedido fica `PENDING` para sempre com dinheiro capturado, sem estorno e sem alerta.** |
| **Órfão sem `paymentId`** | Se o update de `paymentId` falhar, o pedido fica fora do filtro da reconciliação (`paymentId != null`) → **nunca recuperado por nenhum caminho**. |

---

## Prontidão para vendas

### Um cliente consegue comprar hoje?

**Sim, com ressalvas.** O caminho feliz está completo e foi comprovado ao vivo pelo menos duas vezes (7653 = pagamento + estorno reais; 8422 = cancelamento + e-mail recebido).

| Método | Situação |
|---|---|
| **Cartão** | Funciona no caminho aprovado. **Risco alto**: `in_process` (análise antifraude, comum) é tratado como recusa → pedido cancelado com cobrança ativa. |
| **Pix** | Funciona; pendência tratada pela reconciliação diária (máx 30/dia). Sem polling no front (cliente precisa sair e voltar). |
| **Boleto** | **Só existe sem Mercado Pago** (aprovado automaticamente no sandbox). Com MP ativo, some da UI e é barrado na API. **Não é um meio real de cobrança hoje.** |

### O que depende de intervenção do administrador?

- Registrar envio (código/transportadora/link) — manual via PATCH.
- Solicitar estorno — manual (integral apenas).
- Cancelar pedido — manual, **sem guarda de transição**.
- Preencher custos de embalagem e taxas de pagamento (precificação) — pendência do dono (`PENDENCIAS.md`).
- Repor estoque perdido — **sempre manual**, pois o sistema nunca devolve sozinho.

### O que acontece após o pagamento até a entrega?

1. Aprovação → `finalizarPedidoPago`: baixa de estoque (produto + variação), `usedCount+1`, e-mail de confirmação, link guest, evento ERP.
2. Status `PAID` → admin marcar `PROCESSING` → `SHIPPED` (com rastreio) → `DELIVERED`.
3. Cada mudança de status gera e-mail (outbox com retentativa).
4. 7 dias após `DELIVERED`, convite de avaliação (somente clientes logados).
5. **Não há**: rastreio automático da transportadora, prazo de entrega calculado, nem atualização automática de status.

### Falhas que podem impedir compra, cobrar errado, comprometer estoque ou deixar o comprador sem acompanhamento

| Prioridade | Falha | Classe | Impacto |
|---|---|---|---|
| **P0** | Cartão `in_process` cancela o pedido com cobrança ativa, sem estorno e sem reconciliação (`lib/pagamento.ts:109-113`) | **Defeito confirmado** | **Cobrado e não entregue** |
| **P0** | Sem idempotência de criação de pedido → retry pós-timeout duplica pedido **e** cobrança (`api/pedidos/route.ts:28-70`; `mercadopago.ts:38`) | **Defeito confirmado** | **Cobrança duplicada** |
| **P0** | Webhook não idempotente → baixa de estoque e `usedCount` duplicados (`finalizar.ts:94` vs `:128-135`) | **Defeito confirmado** | **Estoque/cupom corrompidos** |
| **P0** | Estoque pode ficar negativo (soma item-a-item ausente) (`finalizar.ts:107-114`) | **Defeito confirmado** | **Oversell** |
| **P1** | Cancelamento/estorno nunca devolvem estoque (0 `increment` no repo) | **Defeito confirmado** | Perda permanente de unidades |
| **P1** | Pagamento aprovado + estoque insuficiente = pedido `PENDING` eterno, sem estorno/alerta (`finalizar.ts:114-115`) | **Defeito confirmado** | Dinheiro preso, cliente sem resposta |
| **P1** | Cupom de `maxUses` ultrapassável, pior em Pix (`finalizar.ts:137-141`) | **Defeito confirmado** | Desconto concedido indevidamente |
| **P1** | Admin sem máquina de estados; `REFUNDED` setável à mão sem `Refund` (`admin/pedidos/[id]/route.ts:81-102`) | **Defeito confirmado** | Estado financeiro inconsistente |
| **P2** | Produto soft-deletado comprável (`api/pedidos/route.ts:135,155`) | **Risco no código** | Venda de item descontinuado |
| **P2** | Endereço de pedido histórico destruído ao excluir endereço (`api/enderecos/[id]/route.ts:70`) | **Risco no código** | Perda de dado de entrega |
| **P2** | Rotação de link guest antes do envio, envio sem outbox (`reenviar/route.ts:35-39`) | **Risco no código** | Comprador sem acompanhamento |
| **P2** | Cartão/boleto pendentes nunca reconciliados (filtro só PIX) | **Risco no código** | Pedidos presos |
| **P3** | Webhook sem rate-limit e assinatura opcional (`webhook/route.ts:42-56`) | **Risco no código** | Superfície de abuso |
| **P3** | Guest não avalia e não recebe convite (`cron/avaliacoes/route.ts:35`) | **Risco no código** | Perda de prova social |
| **P3** | Frete flat, sem transportadora real | **Parcial ou manual** | Custo comercial |
| **—** | Driver de e-mail efetivo, schedules e logs de runtime | **Falta de evidência** | Não verificável sem painel |

### Bloqueadores reais para operar × melhorias futuras

**Bloqueadores reais (afetam cada venda):**
1. Cartão em análise cancela pedido cobrado (P0).
2. Dupla cobrança por retry sem idempotência (P0).
3. Webhook não idempotente corrompendo estoque/cupom (P0).
4. Oversell por estoque negativo (P0).

**Melhorias futuras (não impedem operar):**
Frete real · estorno parcial · busca de pedido por número no admin · detalhe de pedido na conta · avaliação para guest · rastreio automático · polling de Pix · WhatsApp com contexto · `empresa_id`/multi-loja.

---

## Próximos passos recomendados

> Nenhum iniciado automaticamente — decisão do dono.

1. ~~**Fechar os 4 P0**~~ — **FECHADO** (cartão `in_process`, idempotência de criação, idempotência de webhook, estoque negativo). Ver §11.
2. **Decidir a reposição de estoque** em cancelamento de pedido já `PAID` (P1) — hoje é perda permanente e manual. A matriz de decisão está em §11.3; a implementação continua pendente.
3. ~~**Adicionar guarda de transição** no PATCH admin e proibir `REFUNDED` manual~~ — **FECHADO**. Ver §11.
4. **Confirmar no painel Vercel**: `EMAIL_DRIVER` efetivo, `RESEND_API_KEY`, `CRON_SECRET` e schedules ativos — fecha a lacuna de "falta de evidência" dos e-mails e crons. *(Continua não verificável sem o painel.)*
5. **Backfill do evento ERP do 7653** — permanece preparado e **não executado** (`scripts/backfill-erp-estorno-7653.ts`); agora sem destino, adiado junto da integração.
6. **(novo) Reserva de cupom na criação do pedido** — a checagem de elegibilidade ainda é de leitura; duas criações simultâneas podem ambas passar. O `usedCount` está protegido (§11.2), mas a reserva fecharia a causa-raiz.

---

## Limitações desta rodada

- **Sem acesso à base de produção** nesta sessão → nenhum número de pedidos, estoque ou fila é reportado.
- **Sem acesso ao painel Vercel** → driver de e-mail efetivo, credenciais e execução de crons **não comprovados**.
- **Sem `curl`/logs de runtime** → não há comprovação de logs.
- **`node_modules` corrompido** (symlink loop) neste checkout → a suíte **não pôde ser re-executada**; a contagem de 52 arquivos/~477 testes é por análise estática. Os defeitos acima foram confirmados por **leitura direta do código**, o que é evidência mais forte que um suite verde — inclusive porque **o próprio teste documenta a ausência de guarda** (`lib/__tests__/concorrencia-erp.test.ts:145-148`). *(A causa do symlink loop foi identificada e corrigida: `node_modules` e `apps/web/node_modules` estavam **versionados como symlinks auto-referenciais** pelo commit `1c1a67d` — ver §11.)*
- Nenhuma operação financeira, envio, backfill ou dreno foi realizado. **`DC-20261017-7653` permanece estornado.**

---

## 11. Aplicação das correções (correção de integridade do checkout)

> Esta seção é o estado **atual**. As seções §6–§10 acima registram o defeito
> como estava em `main` no SHA analisado; os `arquivo:linha` ali **não** valem
> mais.

### 11.1 Defeitos fechados

| # | Defeito (§10) | Como foi corrigido | Local atual |
|---|---|---|---|
| **P0-1** | Cartão `pending`/`in_process` tratado como recusa | O ramo do cartão passa a devolver `success: true, status: "PENDING"` para `pending`/`in_process` (só recusa real vira `FAILED`). O pedido fica aguardando e a confirmação chega pelo webhook/reconciliação. | `lib/pagamento.ts` (ramo `card`) |
| **P0-2** | Criação de pedido sem idempotência | `Order.idempotencyKey` (novo campo + índice único). A chave vem do header `Idempotency-Key` (prioridade) ou do corpo; o retry devolve o **mesmo pedido** (P2002 tratado → 200 `replayed`) e **não cobra de novo**. A mesma chave vai para o `X-Idempotency-Key` do MP. | `api/pedidos/route.ts`, `schema.prisma`, migração `20261022090000_order_idempotency_key` |
| **P0-3** | Webhook não idempotente | A guarda de transição virou **autoritativa dentro da transação**: a linha do pedido é travada (`FOR UPDATE`) e **recarregada dentro da tx**; quem perde a corrida enxerga o estado já liquidado e sai sem escrever. O fast-path de leitura fora da tx permanece apenas como otimização. | `lib/pedidos/finalizar.ts` |
| **P0-4** | Estoque podendo ficar negativo | A demanda é **agregada por produto e por variação** antes de qualquer conferência (duas linhas do mesmo produto somam). Produtos **e** variações são travados em ordem determinística (`ORDER BY id FOR UPDATE`). A baixa passa a ser uma escrita por produto/variação, não uma por linha. A mesma agregação foi aplicada à validação do checkout. | `lib/pedidos/finalizar.ts`, `api/pedidos/route.ts` |
| **P1** | `coupon.usedCount` ultrapassava `maxUses` | Incremento agora é **travado e condicionado**: a linha do cupom é travada, recarregada, e o incremento só ocorre se ainda houver vaga. `usedCount` nunca passa de `maxUses`. Se a vaga esgotou, o pedido **ainda confirma** (pagamento é irreversível) e o incidente é logado como alerta. | `lib/pedidos/finalizar.ts` |
| **P1** | `REFUNDED` manual no PATCH admin | PATCH passou a expor **máquina de estados**: não aceita regressão de fase e **recusa `REFUNDED`** (status e `paymentStatus`) com 409, apontando para `/api/admin/pedidos/{id}/estornar` — o único caminho que cria a linha `Refund` 1:1. | `api/admin/pedidos/[id]/route.ts` |
| **P1** | Reconciliação só cobria PIX | Varredura ampliada para **PIX + CARD + BOLETO**, cada um com a sua janela de expiração (48h / 7 dias / 5 dias). Padrão de `take` subiu de 30 para 100. | `lib/reconciliar-pix.ts` |
| **P1** | Produto soft-deletado comprável | A validação do checkout passou a exigir `deletedAt: null` além de `isActive`. | `api/pedidos/route.ts` |
| **P0-5** | Webhook não valida identidade do pagamento | Validação de identidade no webhook: conferência de `transaction_amount` vs total do pedido, `currency_id` vs BRL, e associação por `external_reference`. Divergências são registradas via `console.error` e o webhook responde `200` (o provedor para de reenviar); a confirmação é adiada para o admin. | `apps/web/src/app/api/pagamentos/webhook/route.ts` |
| **P0-6** | Resposta de pagamento perdida deixa pedido PENDING sem `paymentId` | Recuperação por `GET /v1/payments/search?external_reference=`: a varredura de reconciliação agora inclui pedidos sem `paymentId`, busca o pagamento pelo `external_reference` (o próprio orderId), e o aplica o fluxo normal (finaliza ou cancela). | `apps/web/src/lib/reconciliar-pix.ts` |
| **P1-6** | Reserva atômica de cupom na criação do pedido | O consumo de `maxUses` passou a ocorrer na **CRIAÇÃO** do pedido, por UPDATE condicional no banco (`usedCount < maxUses` com RETURNING). Se não houver vaga, o pedido nem nasce (400). O consumo na finalização foi removido; `couponReserved` flag distingue os novos pedidos. | `api/pedidos/route.ts`, `lib/pedidos/cupom-reserva.ts`, `schema.prisma`, migração `20261022110000_order_hold_cupom_reserva` |
| **P1-7** | Pagamento aprovado sem estoque = retenção operacional | O `finalizarPedidoPago` não lança mais exceção quando o estoque não cobre. Em vez disso, grava `paymentStatus=PAID` (fato financeiro), mantém `status=PENDING` (não fatura), e define `holdCode=ESTOQUE_INSUFICIENTE`, `holdReason` e `holdAt`. O admin bloqueia PROCESSING/SHIPPED/DELIVERED enquanto hold existir; PATCH com `liberarHold: true` re-tenta a finalização (o admin repõe estoque antes). | `apps/web/src/lib/pedidos/finalizar.ts`, `apps/web/src/app/api/admin/pedidos/[id]/route.ts` |

### 11.2 Invariante do cupom — decisão registrada

Se dois pedidos concorrentes disputam o **último** uso de um cupom, apenas um
consome a vaga; o outro **ainda é confirmado como PAID**, porque o pagamento já
é irreversível no provedor — recusar a confirmação deixaria um pedido pago
pendurado para sempre. O contador **nunca** ultrapassa `maxUses` e a
discrepância fica visível no log como `[finalizar:cupom-esgotado]`.

**Limite remanescente conhecido (não endereçado aqui):** a checagem de
elegibilidade na **criação** do pedido é de leitura; duas criações simultâneas
podem ambas passar por ela. O `usedCount` continua protegido pelo invariant
acima, mas a *reserva* de cupom na criação é um passo futuro.

### 11.3 Reposição de estoque — política

Cancelamento de pedido **não** devolve estoque automaticamente (comportamento
preservado, `lib/estorno.ts:17-18`). Matriz de decisão:

| Situação | Estoque | Justificativa |
|---|---|---|
| Pedido cancelado **antes** do pagamento (`PENDING`→`CANCELLED`) | **Não devolve** — nunca foi baixado | A baixa só acontece em `PENDING`→`PAID`. |
| Pedido pago **cancelado comercialmente** (`PAID`→`CANCELLED`) | **Não devolve automaticamente** | Pode já estar separado/entregue; exige decisão humana. **É a lacuna P1 permanente.** |
| Estorno (`PAID`→`REFUNDED`) | **Não devolve** | Estorno ≠ devolução física. |
| Estoque físico realocado/recebido | **Manual, via admin** | Único caminho hoje: editar `Product.stock` no painel. |

Recomendação futura: devolver estoque **somente** em cancelamento `PAID` com
`SHIPPED` nunca alcançado, dentro da mesma transação da transição.

### 11.4 Testes que cobrem as correções

| Cobertura | Arquivo |
|---|---|
| Corrida real em PostgreSQL (2 conexões): agregação de estoque, trava de variação, idempotência de webhook, `maxUses`, `idempotencyKey` | `lib/__tests__/checkout-integridade-pg.test.ts` (9 testes) |
| Cartão `in_process`/`pending`/`rejected`; reuso da chave no header do MP | `lib/__tests__/pagamento-mp.test.ts` |
| Máquina de estados do admin (409 em `REFUNDED` manual e em regressão) | `lib/__tests__/admin-pedidos-patch.test.ts` |
| Reconciliação com janela por método | `lib/__tests__/reconciliar-pix.test.ts` |

Suíte completa na correção: **53 arquivos / 510 testes, todos verdes**
(baseline anterior: 52 / 493), em PostgreSQL 17 real — não PGlite.

### 11.5 Correção do ambiente de desenvolvimento

A causa do "symlink loop" que impedia a suíte foi identificada: `node_modules` e
`apps/web/node_modules` estavam **versionados no git como symlinks
auto-referenciais** (cada um apontando para si mesmo), introduzidos pelo commit
`1c1a67d` (`composicao(temp)`). Todo clone novo nascia com o loop. As duas
entradas foram **removidas do versionamento**; o `.gitignore` (`node_modules/`)
já cobre o caso e `npm ci` passa a criar os diretórios reais.
