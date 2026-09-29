# Auditoria — Divine Closet: melhorias do e-commerce e sistema de precificação

Data: 2026-09-29
Escopo: auditoria, sem correções.
Repositório: `/home/opencode/projects/Divine_Closet_e-commerce`

## 1. Resumo executivo

Foram avaliados 31 itens: 24 da Parte A e 7 da Parte B.

- Parte A: ✅ 0, ⚠️ 15, ❌ 8, 🚫 1
- Parte B: ✅ 0, ⚠️ 2, ❌ 5, 🚫 0
- Total: ✅ 0, ⚠️ 17, ❌ 13, 🚫 1

Os problemas mais graves são:

1. **Risco futuro de vazamento de custos, sem teste obrigatório nem proteção completa.**
   Hoje não há vazamento ativo apenas porque a migration de precificação não foi aplicada ao banco auditado.
   Entretanto, `apps/web/src/app/api/produtos/route.ts:79-87` retorna `...rest` sem lista explícita de campos, e
   `apps/web/src/app/api/wishlist/route.ts:19` retorna o objeto completo `i.product`.
   Se a migration for aplicada, os novos campos de custo passarão a trafegar nessas respostas.
   Não existe teste automatizado para a API pública sem custos, nem RLS para as tabelas de precificação.

2. **O banco de desenvolvimento está dessincronizado do código e a loja dinâmica está quebrada.**
   A migration `20260929150000_lotes_e_configuracao` existe no repositório, mas não está em `_prisma_migrations`.
   O Prisma Client gerado já espera os novos campos de `Product`, enquanto a tabela real não os tem.
   Resultado observado no servidor local de produção:
   - `/api/produtos?pageSize=1` retornou `500 {"error":"Erro ao carregar produtos"}`;
   - `/produtos`, `/categoria/vestidos` e `/ofertas` exibiram `Banco indisponível`;
   - PDPs presentes no sitemap, como `/produtos/blusa-cassandra`, retornaram 404.

3. **O relatório anterior afirma interfaces de precificação que não existem.**
   `RELATORIO-FINAL.md` diz que há telas de configuração/lotes, bloco no produto, colunas/filtros e recálculo com diff.
   Nada disso existe no código:
   - não há rotas `apps/web/src/app/admin/*lotes*`, `*precific*` ou `*materiais*`;
   - não há rotas `apps/web/src/app/api/*lotes*`, `*materiais*` ou `*precific*`;
   - os formulários de produto e as APIs de produto não aceitam nem salvam snapshots;
   - `lib/precificacao` só é importado pelos próprios testes.

4. **O módulo de precificação acerta o preço final do exemplo por coincidência, mas erra o custo intermediário.**
   Cadeia real medida com os números da vendedora:
   - bruto: `1976.235294117647`;
   - arredondado: `1977`;
   - preço bruto: `3954`;
   - sugerido: `3999`.
   O método manuscrito exige custo arredondado de `2000` (`R$ 20,00`), não `1977`.
   Além disso, faltam rateio proporcional, `embalagem_entra_no_markup=false`, validação de peças iguais a zero e margens decimais.

5. **SEO/estrutura/dados institucionais têm entrega parcial e sinais de placeholder em produção.**
   Não há JSON-LD de `Product`; o JSON-LD de `Organization` fica em payload do Next/fluxo cliente, não como bloco SSR rastreável;
   IDs GA/Google são coletados no admin, mas nunca injetados; não há banner de consentimento nem eventos GA/Pixel;
   contato/empresa/WhatsApp são placeholders exibidos como conteúdo real; o contato é mock.

Nenhuma correção foi aplicada durante esta auditoria.

## 2. Ambiente e saúde do repositório

### 2.1 Comandos executados

Typecheck:

```text
PATH="/home/opencode/.local/node/bin:$PATH" ./node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json
TSC_EXIT:0
```

Testes:

```text
PATH="/home/opencode/.local/node/bin:$PATH" npm test
Test Files  13 passed (13)
Tests 84 passed (84)
```

Lint:

```text
PATH="/home/opencode/.local/node/bin:$PATH" npm run lint
```

Resultado: concluído sem erros; apenas avisos esperados de `<img>`/`next/image` e fonte customizada.
O `next lint` também informou que está depreciado no Next 16.

Build:

```text
PATH="/home/opencode/.local/node/bin:$PATH" node node_modules/next/dist/bin/next build apps/web
BUILD_EXIT:0
```

O build gerou todas as rotas públicas e administrativas listadas no relatório do próprio Next, incluindo:

```text
/api/produtos
/api/wishlist
/api/carrinho
/api/categorias
/api/avaliacoes
/produtos
/produtos/[slug]
/categoria/[slug]
/ofertas
/robots.txt
/sitemap.xml
```

### 2.2 Servidor local usado nos testes dinâmicos

Foi usado um servidor Next de produção, construído a partir do código atual, em:

```text
http://127.0.0.1:3100/
```

Isso explica por que algumas páginas estáticas/metadata funcionam enquanto consultas dinâmicas a `Product` falham:
consultas estreitas sem os novos campos funcionam; consultas ao modelo completo `Product` falham porque o banco não tem as colunas novas.

### 2.3 Banco auditado

Consultas somente leitura mostraram:

- a tabela real `public."Product"` não contém:
  - `lote_id`;
  - `custo_peca_centavos`;
  - `custo_embalagem_centavos`;
  - `custos_extras_centavos`;
  - `custos_extras_descricao`;
  - `markup_percentual`;
  - `preco_sugerido_centavos`;
  - `precificacao_calculada_em`.
- as tabelas abaixo não existem no banco:
  - `LoteCompra` / `lotes_compra`;
  - `ConfigPrecificacao` / `config_precificacao`;
  - `MateriaisEmbalagem` / `materiais_embalagem`.
- `_prisma_migrations` termina em:
  - `20260928184150_related_products`;
  - a migration `20260929150000_lotes_e_configuracao` não foi aplicada.
- `Review`/`ReviewPhoto` têm RLS e políticas públicas apenas para `APROVADA`.
- `Product` tem RLS habilitado, mas a única política relevante encontrada foi ampla para o papel de aplicação.
- Não há políticas RLS para precificação porque as tabelas sequer existem.

## 3. Parte A — melhorias do e-commerce

Legenda:

- ✅ Feito e verificado
- ⚠️ Parcial
- ❌ Não feito
- 🚫 Bloqueado

| Item | Status | Evidência resumida | O que falta / problema exato |
|---|---:|---|---|
| A1. Cabeçalho e carrinho | ⚠️ | `Header.tsx:107-123` tem link `/carrinho`, ícone, `min-h-11 min-w-11`, `aria-label` e badge somente quando `badge` existe. `cart.ts:3-9` retorna `null` para zero e limita a `9+`. `CartProvider.tsx:22-60` atualiza a contagem por `fetch("/api/carrinho")` após adicionar, sem reload. Testes de `formatCartCount`: 5/5 passaram. | O teste manual completo de adicionar 2 + 1, verificar badge 3 e remover até sumir não pôde ser executado de ponta a ponta porque consultas dinâmicas a `Product` estão quebradas pela dessincronização banco/código. Também não há teste automatizado do fluxo completo do badge. |
| A2. Slugs e duplicatas | ⚠️ | `relatorio-duplicatas.md` foi gerado com 4 produtos com sufixo numérico e diz explicitamente que nada foi apagado ou mesclado. `schema.prisma:105,127` tem `@unique` para slug. `api/admin/produtos/route.ts:81-89` retorna 409 em colisão em vez de criar sufixo silencioso. `produtos/[slug]/page.tsx:67-75` tem `permanentRedirect` quando existe `SlugRedirect`. | Não foi possível testar redirect 301 real porque a tabela `SlugRedirect` está vazia no banco auditado. Também não foi testada inserção de slug duplicado, pois isso alteraria dados e a auditoria não faz mutações. |
| A3. Categorias | ⚠️ | `Category` tem `showInMenu` e `showInHome`. `lib/categorias.ts:24-62` centraliza menu e combinação “Calças e Shorts”. Testes de categorias: 7/7 passaram. `/api/categorias` retornou 200 com 10 categorias, flags e contagens. Metadata de `/categoria/vestidos` está correta, com canonical. | A listagem dinâmica de produtos por categoria exibe `Banco indisponível` por causa da dessincronização. Não foi possível comparar, produto a produto, menu principal versus “Compre por categoria” em estado saudável. |
| A4. Página de ofertas | ⚠️ | `ofertas/page.tsx` usa `Catalogo` com `soOferta: true`. `Catalogo.tsx` filtra `discountPercent: { gt: 0 }`. Links “Ver ofertas” apontam para `/ofertas`; não há links restantes para `sort=price_asc` como substituto de ofertas. Há textos próprios para estado vazio. | A página dinâmica exibe `Banco indisponível`, então não foi possível confirmar item a item que todos têm desconto, nem testar o estado vazio real com promoções zeradas. |
| A5. Home sem repetição | ⚠️ | `app/page.tsx:14` usa `used: Set<string>` e `takeFresh` para destaques, novidades e ofertas. `lib/home.ts:12-25` exclui IDs usados e marca os escolhidos. `shouldShow` exige ao menos 4 itens. Testes de `home`: `excludeUsed`, `takeFresh` e `shouldShow` passaram. | A home dinâmica está sem produtos por causa da dessincronização, então a verificação manual de IDs por seção não pôde ser concluída no estado atual. A lógica e os testes estão corretos, mas o comportamento vivo não foi observado. |
| A6. Tamanho/cor | ⚠️ | `lib/tamanhos.ts:1-42` implementa ordem canônica PP→G3, numéricos crescentes, desconhecidos e “Único” por último. Testes de `ordenarTamanhos`: 6/6 passaram. `AddToCart.tsx:37-75` ordena, recalcula disponibilidade por combinação, desabilita e risca indisponíveis, exige tamanho/cor e mostra erro claro. A API valida combinação e estoque da variação em `api/carrinho/route.ts:96-142`. | O teste manual em dois produtos reais ficou bloqueado porque as PDPs dinâmicas retornam 404 no ambiente atual. Não há teste automatizado de ponta a ponta do seletor. |
| A7. Estoque | ⚠️ | `estoque.ts:8-21` implementa `esgotado`, `baixo` e `disponivel`. `textoEstoque(63)` retorna `Em estoque`, sem número. `textoEstoque(3)` retorna `Restam apenas 3 unidades`. Testes passaram. `/api/produtos` remove `stock`, exceto quando o estado é `baixo`. A API do carrinho valida variação e quantidade inicial. | Há lacuna: `api/carrinho/route.ts:164-183` permite `PATCH` com quantidade arbitrária até 99 sem revalidar estoque do produto/variação. Além disso, a verificação de payload de estoque alto ficou bloqueada porque a API pública de produtos retorna 500 no ambiente atual. |
| A8. Conteúdo do produto | ⚠️ | O schema tem `composicao`, `instrucoesLavagem`, `comprimento`, `modeloAltura`, `modeloVeste`, `caimento` e `ocasiao`. A PDP só renderiza composição/cuidados e detalhes quando há conteúdo. `metaTitle`/`metaDescription` são campos separados da descrição. `PENDENCIAS.md` reconhece conteúdo pendente. | Os produtos atuais não têm esse conteúdo preenchido, e as PDPs dinâmicas estão inacessíveis no ambiente atual. Portanto, a comparação “descrição versus meta description” em 3 produtos reais não pôde ser concluída. |
| A9. Guia de medidas | ⚠️ | `GuiaMedidas.tsx:12-113` implementa link, modal, fechamento e nota padrão. `lib/medidas.ts` resolve tabela do produto com fallback da categoria. Testes de medidas: 6/6 passaram. O admin permite vincular tabelas a produtos e categorias. | O teste manual de foco preso, ESC e destaque da linha selecionada não foi executado em navegador, e produtos dinâmicos estão indisponíveis. A estrutura existe, mas a interação não foi verificada de ponta a ponta. |
| A10. Galeria | ⚠️ | `ProductSlideshow.tsx` usa `alt={altFor(i)}`, `loading="lazy"` fora da primeira imagem, thumbs, swipe e lightbox. `describeAlt` gera `{Nome}, {cor}, vista {n}` ou alt customizado. O banco mostra `imageAlts` vazios, mas o fallback evita alt vazio. | Não foi possível inspecionar 5 PDPs reais porque retornam 404. Além disso, o projeto usa `<img>` cru sem `width`/`height` nem `next/image`, com vários avisos de lint sobre LCP. |
| A11. Avaliações | ⚠️ | Reviews nascem `PENDENTE`; a API pública só lista `APROVADA`. O admin aprova/rejeita. `findEligibleOrder` exige pedido pago/entregue e produto do pedido. Há cron de convite 7 dias após `entregueEm`. O banco auditado tem zero reviews, sem indício de avaliações falsas. RLS de `Review`/`ReviewPhoto` existe e foi confirmado em `pg_policies`. Testes de avaliações: 4/4 passaram. | O subitem de `aggregateRating` não pôde ser verificado porque não existe JSON-LD de `Product`; ver A14. Também não foram criadas avaliações de teste com mutação de dados durante a auditoria. |
| A12. Recomendações | ⚠️ | `produtos/[slug]/page.tsx:90-153` prioriza vinculados manuais, depois mesma categoria ±40%, depois recentes, até 8, sempre com `stock > 0` e sem o produto atual. “Complete o look” usa `COMPLEMENTOS` e busca até 4. `VistosRecentemente` usa `localStorage`, exclui o atual e exige ao menos 2 itens. Testes puros de `complementosPara`/`pushRecent` passaram. | O teste manual em 3 PDPs ficou bloqueado porque as PDPs retornam 404. Há lacuna real: `COMPLEMENTOS` não tem chave para `saias`, embora `saias` seja categoria ativa; produtos de saia não geram “Complete o look”. |
| A13. SEO/metadata | ⚠️ | Títulos e descriptions de home e categorias são únicos e corretos. Canonical funciona inclusive com parâmetros: `/produtos?q=...` aponta para `/produtos`; `/categoria/...?...` aponta para a categoria limpa. `X-Robots-Tag: noindex, nofollow` foi observado em `/carrinho`, `/checkout` e `/login`. `robots.txt` e `sitemap.xml` retornaram 200 e XML válido. Testes de SEO passaram. | A busca interna `/produtos?q=...` não tem `noindex`, embora o roteiro de auditoria exigisse. PDPs não puderam ser comparadas porque retornam 404 no ambiente atual. |
| A14. Dados estruturados | ❌ | Existe tentativa de JSON-LD de `Organization` em `layout.tsx:34-52,90`, e um helper em `lib/schema-ld.tsx:8-14`. | Não existe JSON-LD de `Product`, `BreadcrumbList` ou `aggregateRating` nas PDPs. O bloco de `Organization` aparece apenas no payload/fluxo cliente do Next, não como `<script type="application/ld+json">` SSR rastreável. Nada pôde ser validado como Rich Result. |
| A15. Imagens/CDN | ⚠️ | Alt tem fallback descritivo e `loading="lazy"` fora da primeira imagem. Amostra real do banco mostra imagens no domínio Supabase e `imageAlts` vazios ou com strings vazias. `upload.ts:79-149` documenta drivers local/S3 e necessidade de bucket/CDN. | Não há `next/image`, dimensões explícitas, abstração de CDN nem URL configurável dedicada. `next.config.ts:4-6` permite `remotePatterns` HTTP amplo (`hostname: "**"`), sem política restrita. `PENDENCIAS.md` não registra claramente a ausência de CDN. |
| A16. Indexação/analytics | ❌ | O conteúdo essencial de home/categoria aparece no HTML inicial. IDs vazios não injetam Meta Pixel. Há página de privacidade com menção à LGPD. | O admin coleta `ga4Id` e `googleAdsId`, mas `layout.tsx` nunca usa `pixels.gtag`; GA/Google Ads não são injetados. O Meta dispara `PageView` sem consentimento quando há ID. Não há banner de consentimento nem eventos `add_to_cart`, `begin_checkout` ou `purchase`. PDP essencial não pôde ser verificada por SSR por causa da dessincronização. |
| A17. Confiança/marca | ❌ | Existem páginas institucional, trocas, FAQ, privacidade e contato, com metadata e canonical. | O rodapé exibe permanentemente `Pagamento em sandbox (modo dev)`. Contato/empresa/WhatsApp/endereço são placeholders publicados como conteúdo real, não condicionais a configuração. O formulário de contato apenas faz `console.log("[CONTATO MOCK]")` e diz que não há envio real. |
| A18. WhatsApp/redes/trocas | ❌ | A página `/trocas` existe e cita 30 dias. | Não há botão/link de WhatsApp com conversa e mensagem pré-preenchida, nem links de redes sociais. A política de frete de troca não está definida como regra operacional; o conteúdo é genérico/placeholder. |
| A19. Busca | ❌ | Existe busca textual por nome/descrição/SKU em `/api/produtos` e formulário em `Catalogo`. | A busca usa `contains insensitive`, sem normalização de acentos. Não há como provar que “vestido” encontra “Vestidos” de forma robusta, e a API está 500 no ambiente atual. |
| A20. Filtros | ❌ | Existem filtros de categoria, preço, estoque, oferta e ordenação. | Não existem filtros de tamanho ou cor na API nem na interface de catálogo, embora o roteiro exigisse teste combinado desses filtros. |
| A21. Avise-me | ❌ | Existe apenas o texto estático em `AddToCart.tsx:241-245`: `Em breve: avise-me quando chegar.` | Não há cadastro de contato, fila, reposição, `notificado_em` ou envio. |
| A22. Cupom lead/popup | ❌ | Existem cupons administrativos e validação no checkout/pedido, com incremento de uso. | Não há popup de lead, cooldown, geração de cupom de uso único para lead nem fluxo de captura. O que existe é cupom operacional genérico, não o recurso pedido. |
| A23. Carrinho abandonado | ❌ | O carrinho persiste por usuário/convidado. | Não há job, detecção de abandono, fila ou envio. O único cron é `/api/cron/avaliacoes`, para reviews. |
| A24. Login social | 🚫 | O botão “Continuar com Google” existe, mas fica desativado com `(em breve)` quando `features.socialLogin=false`. O tooltip expõe `TODO-CLIENTE: credenciais OAuth Google`. O schema tem `provider`/`socialId`, mas não há rota OAuth. | Bloqueado por credenciais/configuração OAuth ausentes. O botão não quebra, mas também não implementa login social. |

## 4. Parte B — sistema de precificação

| Item | Status | Evidência resumida | O que falta / problema exato |
|---|---|---:|---|
| B1. Módulo puro | ⚠️ | `lib/precificacao.ts` não importa UI nem banco. Os testes do módulo passam: 21/21. `calcularPrecoSugerido(2000,100,'termina_99')` retorna bruto `4000` e sugerido `3999`; com embalagem `2240`, retorna bruto `4480` e sugerido `4499`; `termina_99` trata `4000/4001/4480/3952` como `3999/4099/4499/3999`. Alertas de prejuízo e embalagem zerada funcionam. | A cadeia completa da vendedora não reproduz o custo intermediário: `custoUnitarioBruto(30000,3596,17) = 1976.235294117647`; `arredondarCusto(...,'inteiro_para_cima') = 1977`, não `2000`. O preço final coincide em `3999`, mas por arredondamento posterior; lucro/markup intermediários ficam errados. Também faltam: rateio proporcional implementado; `embalagem_entra_no_markup=false`; validação que rejeite `quantidade_pecas=0` em vez de trocar por 1; margens decimais como `99,95%`/`49,99%`; e `multiplo_de_X` é apenas fallback para `ceil`. O código usa floats em divisão/multiplicação antes de arredondar, apesar do comentário dizer “centavos inteiros”. |
| B2. Modelo de dados | ❌ | Existem `schema.prisma:156-163,395-429` e `migrations/20260929150000_lotes_e_configuracao/migration.sql:1-111`, com tabelas/campos e materiais zerados no SQL. | No banco auditado, nenhuma tabela nova existe e nenhum campo novo existe em `Product`. `_prisma_migrations` termina na migration anterior. Além disso, há incompatibilidade de mapeamento: o SQL cria tabelas minúsculas como `lotes_compra`, enquanto os models Prisma `LoteCompra`, `ConfigPrecificacao` e `MateriaisEmbalagem` mapeiam, por padrão, para tabelas PascalCase. Mesmo aplicando o SQL como está, o client gerado não encontraria essas tabelas sem `@@map`/`@map`. Não há arquivo `down` dedicado; só comentários manuais de reversão. |
| B3. Configuração/lotes | ❌ | Nenhuma rota de página ou API para lotes, configuração de precificação ou materiais foi encontrada. O menu admin em `admin/layout.tsx:7-19` não tem esses links. Grep por `lotes`, `materiais`, `precific`, `preco_sugerido` e `custo_peca` não encontra chamadas fora testes/schema/migration. | Faltam telas de configuração, CRUD de lotes, edição de materiais, modo “comprei X por R$ Y” e pré-visualização ao vivo. Também não há cálculo em tempo real antes de salvar porque a funcionalidade não existe. |
| B4. Bloco no produto | ❌ | Os formulários novo/editar têm preço, conteúdo, imagens e relacionados, mas nenhum bloco de precificação. As APIs `POST /api/admin/produtos` e `PATCH /api/admin/produtos/[id]` não aceitam `lote_id`, custos, markup, preço sugerido ou snapshots. | Faltam origem do custo, resumo linha a linha, markup editável, custos extras, “Usar preço sugerido”, painel lucro/markup/margem em tempo real, lucro no promocional, alertas e salvamento de snapshots. Produtos antigos ficam “neutros” apenas porque o recurso não existe. |
| B5. Segurança de custos | ⚠️ | Nas respostas amostradas não foram encontradas strings de custo porque as colunas não existem no banco. A API pública filtra estoque alto e o carrinho seleciona campos explícitos. `Review` tem RLS pública apenas para aprovadas. | O desenho é inseguro para o momento em que a migration for aplicada: `/api/produtos` usa `...rest`; `/api/wishlist` retorna `i.product` completo para usuário autenticado; componentes públicos recebem objetos completos do Prisma. Não existe teste automatizado “API pública sem custos”, nem RLS/políticas para precificação. Corrigir exige allow-list explícita antes de aplicar a migration. |
| B6. Recálculo em massa | ❌ | Não há botão, tela de revisão, diff, confirmação seletiva ou API de recálculo. Grep por recálculo/diff não encontra implementação. | Todo o fluxo pedido está ausente. Também não é possível oferecer recálculo ao mudar embalagem porque não há UI para mudar embalagem. |
| B7. Filtros/colunas | ❌ | A lista admin mostra apenas produto, categoria, preço, estoque, status e ações. Não há custo, lucro, margem, ordenação por margem ou filtros “sem custo”/“abaixo da margem”. | Todo o item está ausente. |

## 5. Achados adicionais

### 5.1 Dessincronização crítica entre schema gerado e banco real

A mudança de precificação alterou o Prisma Client sem aplicar a migration. Como quase todas as leituras de produto usam o modelo completo, o ambiente atual apresenta:

```text
/api/produtos?pageSize=1
STATUS=500
{"error":"Erro ao carregar produtos"}
```

```text
/produtos
Banco indisponível
```

```text
/categoria/vestidos
Banco indisponível
```

```text
/ofertas
Banco indisponível
```

```text
/produtos/blusa-cassandra
STATUS=404
```

Isso é mais grave do que “migration pendente”: o deploy atual quebra vitrine, PDP, API pública, carrinho com itens e wishlist com itens.

Observação importante: o sitemap continua listando produtos porque usa `select: { slug: true, updatedAt: true }`, sem os campos novos.
Ou seja, o sitemap prova que há slugs reais, mas as rotas dinâmicas que leem o produto completo falham.

### 5.2 Relatórios anteriores afirmam entrega que não existe

`RELATORIO-FINAL.md` afirma interface admin de precificação, gestão de lotes, bloco no produto, colunas/filtros e recálculo com diff.
O código não contém essas interfaces.

`PENDENCIAS.md` orienta a vendedora a usar `admin → Configurações de Precificação`, cadastrar materiais e usar o bloco no produto.
Esses caminhos não existem.

Isso não é apenas pendência de dados: é documentação do estado do projeto inconsistente com o código.

### 5.3 Carrinho permite alteração de quantidade sem revalidar estoque

`api/carrinho/route.ts:96-142` valida estoque/varetacão na adição inicial, mas `PATCH` em `164-183` grava qualquer quantidade até 99 sem consultar estoque.
Para produto sem variação, a soma em `POST` também pode chegar a 99 sem comparar com `product.stock`.

Isso permite carrinho com quantidade acima do estoque real, mesmo que o checkout valide depois.

### 5.4 Analytics incompleto e sem consentimento

O admin coleta GA4/Google Ads, mas o layout nunca usa `pixels.gtag`.
O Meta Pixel, quando configurado, dispara `PageView` imediatamente, sem banner de consentimento.
Não há eventos de comércio nem deduplicação de `purchase` porque não há instrumentação.

### 5.5 Dados institucionais e contato são placeholders publicados

`packages/config/src/defaults.ts:70-98` contém textos de about/troca/privacidade/FAQ e contato fictício/genérico.
O rodapé e páginas institucionais exibem esses valores como conteúdo real.
O contato faz apenas `console.log("[CONTATO MOCK]")`.

Isso é especialmente relevante porque o rodapé já diz “Pagamento em sandbox”, mas o restante do conteúdo operacional parece definitivo.

### 5.6 Imagens sem otimização moderna

Há `loading="lazy"` e alt com fallback, mas não há `next/image`, dimensões explícitas, CDN dedicado ou política restrita de hosts.
`next.config.ts:4-6` permite qualquer host HTTP, o que é amplo demais para produção.

### 5.7 Cobertura de testes limitada à lógica pura

Os 84 testes passam, mas cobrem principalmente funções puras.
Não há testes de rota/API para:

- API pública sem campos de custo;
- carrinho/PDP/listagem após mudanças de schema;
- regras de elegibilidade/moderação de review por HTTP;
- redirects antigos;
- busca/filtros combinados;
- cupom de uso único;
- RLS.

Isso explica por que o build passa enquanto a loja dinâmica está quebrada: os testes não exercem o caminho crítico com o banco real.

## 6. Falhas críticas

1. **Loja dinâmica quebrada por drift de schema:** PDPs 404, API 500 e listagens com `Banco indisponível`.
2. **Risco de vazamento futuro de custos:** allow-list ausente em `/api/produtos` e `/api/wishlist`; nenhuma política RLS para precificação; nenhum teste obrigatório.
3. **Precificação anunciada como pronta sem UI/API:** módulo isolado existe, mas não há configuração, lotes, bloco no produto, snapshots, recálculo ou filtros.
4. **Cadeia de referência com custo intermediário errado:** `1977` em vez de `2000`, mesmo com preço final coincidente.
5. **Conteúdo operacional placeholder publicado:** contato/empresa/WhatsApp/endereço, contato mock e política genérica apresentados como definitivos.

## 7. Pendências confirmadas do dono da loja

Confirmadas como ainda pendentes, por código/configuração:

- custos reais de sacola, papel, tag e cartão;
- confirmação sobre embalagem entrar ou não no markup;
- confirmação da regra de arredondamento do custo;
- margem mínima, se desejar;
- taxas de pagamento, se desejar;
- lotes anteriores, se quiser cadastrá-los;
- razão social, CNPJ, endereço, telefone, WhatsApp e e-mail reais;
- redação final de sobre/trocas/privacidade/FAQ;
- artes reais de banner;
- contas/IDs Meta, Google Ads e GA4;
- gateway real de pagamento e credenciais;
- provedor real de e-mail/SMTP;
- transportadora/tabela real de frete;
- credenciais OAuth Google, se quiser login social;
- conteúdo completo dos produtos: composição, lavagem, medidas, modelo, descrição própria e SEO.

## 8. Recomendação de próximos passos

Ordem sugerida, sem implementar agora:

1. **Congelar deploys até resolver o drift:** aplicar ou reverter a mudança de precificação no Prisma Client; nunca gerar client com colunas que o banco não tem.
2. **Corrigir o mapeamento Prisma/SQL:** usar `@@map`/`@map` ou renomear tabelas/colunas para que SQL e client concordem.
3. **Criar allow-list pública antes de qualquer migration de custo:** selecionar explicitamente campos seguros em `/api/produtos`, wishlist, carrinho, PDP e componentes cliente; adicionar teste automatizado “sem custos”.
4. **Adicionar RLS/políticas para precificação somente após modelagem final:** tabelas novas não devem ser legíveis por `anon`/`authenticated`.
5. **Corrigir `arredondarCusto` para a unidade correta:** `1976,...` centavos deve virar `2000` centavos no modo `inteiro_para_cima`.
6. **Implementar o que falta no módulo:** rateio proporcional, `embalagem_entra_no_markup=false`, erro para `quantidade_pecas=0`, `multiplo_de_X` parametrizado e margens decimais.
7. **Só então construir UI/API:** configuração, lotes, materiais, bloco no produto, snapshots, recálculo com diff e filtros administrativos.
8. **Recuperar a loja dinâmica e repetir a auditoria manual:** PDP, listagem, ofertas, recomendações, busca/filtros, carrinho e checkout.
9. **Fechar SEO/estrutura:** JSON-LD de `Product`, `BreadcrumbList`, `aggregateRating` somente com avaliações reais aprovadas, `noindex` para busca interna e validação Rich Results.
10. **Fechar analytics/LGPD:** injetar GA somente com ID e consentimento, implementar eventos com deduplicação de `purchase`, ou remover a coleta até haver decisão.
11. **Remover placeholders da vitrine ou marcá-los como rascunho interno:** contato, empresa, WhatsApp, endereço, banners e políticas não podem parecer definitivos.
12. **Adicionar testes de integração para o caminho crítico:** API pública, PDP, listagem, redirects, carrinho/estoque, cupom e RLS.

---

## 9. Correções aplicadas em 2026-09-29 (pós-auditoria, a pedido do usuário)

Nada acima foi alterado; o que segue registra o que foi corrigido após o relatório.

### 9.1 Dessincronização banco/código — RESOLVIDO
- Criado `apps/web/src/lib/produto-publico.ts` com allow-list explícita de campos públicos
  (`publicProductCardSelect`, `publicProductDetailSelect`, `toPublicCardProduct`, `toPublicVariations`).
- Todas as leituras públicas (home, catálogo, PDP, `/api/produtos`, wishlist, carrinho, pedidos)
  passaram a usar selects explícitos; estoque exato só trafega quando baixo/esgotado.
- `AddToCart` refatorado para trabalhar com estado de disponibilidade (sem expor estoque alto);
  quantidade máxima para estoque alto é 99, com validação final no servidor.
- Verificado ao vivo: `/api/produtos`, PDPs, `/produtos`, `/categoria/*` e `/ofertas` voltaram a 200,
  sem nenhuma chave de custo no HTML/JSON.

### 9.2 Modelo de dados — RESOLVIDO
- Adicionados `@@map("lotes_compra")`, `@@map("config_precificacao")` e
  `@@map("materiais_embalagem")` no schema, alinhando Prisma e SQL.
- Campo `custos_extras_descricao` corrigido para `String?` (o `null` explícito quebrava o
  `product.create` com erro enganoso `Argument category is missing`).
- Migration `20260929150000_lotes_e_configuracao` aplicada ao banco de dev (15 statements),
  registrada em `_prisma_migrations`; 4 materiais com custo 0 e config padrão presentes.

### 9.3 Segurança de custos — RESOLVIDO (por desenho + teste)
- Allow-list em todas as respostas públicas; teste automatizado
  `apps/web/src/lib/__tests__/produto-publico.test.ts` (6 testes) garante ausência de
  `lote_id`, `custo_*`, `markup_percentual`, `preco_sugerido_centavos` e `precificacao_calculada_em`,
  além de estoque exato só quando baixo.

### 9.4 Módulo de cálculo — RESOLVIDO
- `arredondarCusto` agora arredonda em REAIS: `1976.2353 → 2000` (antes: `1977`).
- Cadeia da vendedora verificada de ponta a ponta: bruto `1976.2353`, arredondado `2000`,
  preço bruto `4000`, sugerido `3999`, lucro `1999`, markup `99.95%`, margem `49.99%`.
- Novos: `ratearFreteProporcional`, `embalagemNoMarkup` em `calcularPrecoSugerido`,
  erro em `quantidade_pecas = 0`, `multiplo_de_X` parametrizado, percentuais com 2 casas.
- Testes de precificação: 28/28 (inclui pipeline completo, rateio, termina_99, prejuízo, validação).

### 9.5 Telas e APIs de precificação — IMPLEMENTADO
- APIs: `GET/POST /api/admin/lotes`, `GET/PATCH/DELETE /api/admin/lotes/[id]`,
  `GET/PUT /api/admin/precificacao`, `POST /api/admin/precificacao/materiais`,
  `PATCH/DELETE /api/admin/precificacao/materiais/[id]` (com modo "comprei X por R$ Y"),
  `POST /api/admin/produtos/recalcular` (diff + aplicação confirmada).
- Telas: `/admin/precificacao` (regras, materiais, preview ao vivo),
  `/admin/lotes` (CRUD + cálculo em tempo real + alerta de excesso de vinculados).
- Bloco "Precificação" nos formulários novo/editar produto, com "Usar preço sugerido",
  painel lucro/markup/margem sobre o preço digitado e alertas; snapshots gravados no salvamento.
- Lista de produtos: colunas custo/lucro/margem, filtros sem-custo/abaixo-da-mínima,
  ordenação por margem e fluxo de recálculo com diff.
- Fluxo E2E validado ao vivo (12/12): lote → produto → snapshots → embalagem →
  diff → preço manual com alerta → API pública limpa → aplicação do recálculo.

### 9.6 SEO/estrutura/analytics — PARCIALMENTE RESOLVIDO
- JSON-LD `Product` + `BreadcrumbList` em SSR nas PDPs (`aggregateRating` só com
  avaliações aprovadas reais; `availability` reflete o estoque); `BreadcrumbList` nas
  categorias; `Organization` convertido para script SSR.
- `noindex, nofollow` para busca interna (`/produtos?q=...`); canonical preservado.
- Banner de consentimento LGPD (`dc-consent`); Meta Pixel e gtag (GA4/Ads) só injetados
  com consentimento e com IDs configurados; eventos `add_to_cart`, `begin_checkout` e
  `purchase` (deduplicado por pedido) via dataLayer.
- Avisos "sandbox" no rodapé/home/sucesso agora condicionais a `PAYMENT_DRIVER=mock`.
- Botão WhatsApp na PDP e no contato com mensagem pré-preenchida (nome + link do produto).
- Pendente (depende do dono): conteúdo institucional real, contato/empresa verdadeiros,
  IDs Meta/GA, gateway real, SMTP, transportadora, OAuth Google, filtros de tamanho/cor,
  "avise-me", cupom de lead e carrinho abandonado.

### 9.7 Validação final pós-correções
- `tsc --noEmit`: limpo.
- `npm test`: 14 arquivos, 97 testes, todos passando.
- `next lint`: 0 erros (apenas warnings de `<img>`).
- `next build`: exit 0.
- Dados de teste da auditoria removidos do banco; sacola zerada; admin temporário removido.
