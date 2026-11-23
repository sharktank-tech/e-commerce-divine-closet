# Divine Closet — Homologação pós-merge PR #24 e sidebar PR #25

**Data de revisão:** 23/11/2026
**Natureza:** inspeção de leitura e análise estática; sem merge, deploy ou operações financeiras.
**Branch documental:** `docs/homologacao-mobile-pr24-20261123`
**Base examinada:** `main` @ `9157aab694bfdccf9881eaff005651547bb27eda`

## 1. Estado confirmado no GitHub

| Elemento | Evidência | Resultado |
|---|---|---|
| PR #24 — filtros mobile | https://github.com/sharktank-tech/e-commerce-divine-closet/pull/24 | **merged**, 02/11/2026; head `013cd5fdb7be561880b4427335457854bbe24cd0`; merge commit **`784bfdda48e139fb2ec87ebb2f1067672e1449f0`** |
| PR #25 — admin/sidebar | https://github.com/sharktank-tech/e-commerce-divine-closet/pull/25 | **merged**, 03/11/2026; head `cf06b5b014086834fecc6eeca663b53eb9f1b857`; merge commit **`3dbf8334ddca268db4a86b879ed60c6bf16afa17`** |
| `main` atual | GitHub commit fetch | `9157aab694bfdccf9881eaff005651547bb27eda`; 19 commits depois do merge PR #24 e 3 depois do PR #25 |
| PR #26 — GA4.2 | https://github.com/sharktank-tech/e-commerce-divine-closet/pull/26 | Aberto, draft, não integrado |
| Branch `fix/admin-sidebar-overlap` | Busca GitHub | Existe remotamente; não requer novo push |

**Correção de rastreabilidade:** o commit `3dbf833`, atribuído anteriormente ao PR #24, corresponde ao **merge do PR #25**. O merge do PR #24 é `784bfdda`.

## 2. Inspeção visual em navegador real — site público

Endereço visitado: https://www.divinecloset.com.br

Execuções de navegador:
- Catálogo: https://agent.tinyfish.ai/runs/6fb151f7-c902-411b-9a34-0d6857e997af
- Admin: https://agent.tinyfish.ai/runs/48b7276d-72bb-4005-97e2-28be2739536c
- Home/checkout: https://agent.tinyfish.ai/runs/4bb6d4c9-a3e5-4048-9358-7b044f3da501

### Catálogo /produtos
**PASS verificado no desktop:** botão Filtros abre drawer; inputs de preço e checkbox de estoque editáveis; aplicar/limpar; botão X; fechar via Escape e backdrop; seletor de ordenação exibido.

**SUSPEITA P1 (reprodução incompleta):** após aplicar preço mínimo=35, máximo=50 e estoque, a automação informou que a contagem permaneceu em “10 produtos encontrados” e não identificou os chips ativos esperados. É necessário registrar a URL *exata* após submit, DOM, resposta de rede e lista de produtos para distinguir bug de cache, parâmetro ausente ou falha no teste. Não classificar como falha definitivamente reproduzida.

**NÃO TESTADO:** 375×812, 390×844, 768×1024, zoom 200%, leitor de tela, Tab/Shift+Tab/focus trap e retorno do foco; ferramenta não permitiu fixar viewport mobile ou confirmar foco. Teste visual ocorreu em viewport desktop padrão, aproximado, sem medida exata.

### Admin /admin e /admin/pedidos
**PASS parcial:** ambas as URLs sem sessão mostram login administrativo, sem Header/Footer públicos e sem overlay de cookies da loja. **NÃO TESTADO:** sidebar autenticada, dashboard/tabela real de pedidos, responsividade após login, navegação interna. Não foram usadas credenciais nem alterados dados.

### Home e checkout
**PASS parcial:** home renderizou Header, banners, categorias, produtos e Footer; preferências de cookies visíveis. `/checkout` com carrinho vazio direcionou a `/carrinho` e exibiu estado vazio. Nenhum pedido, pagamento, envio de dados ou tracking financeiro de teste foi executado.

## 3. Achados estáticos na main atual

Arquivo `apps/web/src/components/loja/CatalogoFiltros.tsx`:
- **P1/A11y:** labels “Preço mínimo (R$)” e “Preço máximo (R$)” não possuem `htmlFor` e os respectivos inputs não têm `id`; são labels visuais não programaticamente associados.
- **P2/Toque:** botão Filtros e select de ordenação usam `min-h-[40px]`, abaixo da meta de 44px adotada no PR.
- Focus trap implementado de modo manual: seleciona elementos potencialmente focáveis sem verificar visibilidade/disabled. Validar por teclado antes de aprovar.
- Chips ativos existem no código, mas não foram confirmados no navegador após submit; confrontar com estado/URL e versão implantada.

Estrutura de layouts confirmada no código:
- `apps/web/src/app/layout.tsx`: providers/tracking global, `STORE_GA4_ID=G-BKNS2XTSH2`.
- `apps/web/src/app/(loja)/layout.tsx`: Header, Footer, ConsentBanner, WhatsAppButton e CartProvider.
- `apps/web/src/app/admin/layout.tsx`: sidebar própria; tela de login não renderiza sidebar.

## 4. CI, Vercel e limites ambientais

- GitHub status para `main` @ `9157aab`: **Vercel: success** com destino https://vercel.com/danilos-projects-dc14d397/e-commerce-divine-closet-web/9aQavUFnHXCbuG57Lvj5vcznZQo3 .
- A conexão disponível da Vercel listou apenas outros projetos (`pollo-modas`, `descontai`); consulta à Divine Closet retornou 404 e listagem de deploys retornou 403. **Não foi possível confirmar o SHA efetivamente em produção nem auditar logs de build/runtime.** Status no GitHub não substitui prova de deploy ativo.
- `git clone`/ `git ls-remote` local indisponível por falha DNS para github.com; não existia checkout local. Consequentemente **npm test, typecheck, lint, build, migrações e Playwright local não foram executados nesta rodada**. Números históricos de 587 testes pertencem ao relatório do agente anterior, **não** a esta homologação.
- Capturas de tela não foram exportadas pela automação; as execuções de navegador acima são a evidência acessível. Sem screenshots e sem testes mobile reais.

## 5. Parecer e próximos critérios

**HOMOLOGAÇÃO BLOQUEADA / PARCIALMENTE EXECUTADA.**
A existência de merge, a separação de layouts no código, o login admin e as interações básicas do drawer desktop estão confirmadas. Faltam provas essenciais de comportamento mobile, acessibilidade por teclado, efeitos reais de filtros e identificação do deployment de produção.

**Ações prioritárias antes do aceite:**
1. **P1** — Reproduzir aplicação de preços/estoque, capturar URL final, query, contagem e chips; comparar com versão de código servida.
2. **P1/A11y** — Associar labels e inputs de preço; testar Tab/Shift+Tab, foco e Escape em Chrome/Firefox mobile/desktop.
3. **P1** — Validar sidebar administrativa com sessão de homologação autorizada em 375/390/768/1280/1440 px, sem alterar pedidos.
4. **Operacional** — obter acesso de leitura ao projeto Divine Closet na Vercel; confirmar deploy ativo e SHA; coletar logs pertinentes.
5. **CI** — executar suíte atual em checkout local com banco descartável, registrar output, screenshots e reprodução de filtros.

Sem merge, deploy, rollback, migration de produção, pagamento, estorno ou modificação de dados nesta rodada.
