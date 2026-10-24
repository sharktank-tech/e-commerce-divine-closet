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

## 11. Correções e revisão executada do PR #16

A evidência corrente, matriz de testes, compatibilidade de pedidos legados e
runbook estão em [REVISAO-CHECKOUT-PR16.md](REVISAO-CHECKOUT-PR16.md).
Os números e classificações de relatórios anteriores foram substituídos pela
execução registrada nesse documento.

- Chave estável enviada pelo frontend, posse verificada e replay antes de carrinho/cupom.
- Reserva de cupom na criação e liberação atômica por pedido, sem recontagem no pagamento.
- Identidade exige referência/valor/moeda reais; webhook pode chegar antes do paymentId.
- Busca vazia ou idade não cancela pagamento potencialmente ativo; múltiplas aprovações geram revisão persistida.
- Hold de estoque só é liberado explicitamente; hold financeiro exige análise humana.
- Confirmação, estoque, ERP e outbox do e-mail nascem na mesma transação.
- Migrações: 28 na base, 31 nesta entrega. Nenhuma migração aplicada foi reescrita.
- Sem operações em produção nesta rodada. Publicação do PR depende de decisão posterior.

Reposição de estoque após cancelamento/estorno continua manual: estorno financeiro
não comprova devolução física. O PATCH administrativo não pode substituir o fluxo
de pagamento ou estorno.
