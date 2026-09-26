# Instruções Técnicas — Desenvolvimento do E-commerce Completo

**Destinatário:** Agente de desenvolvimento local (Claude Code / equipe técnica)
**Objetivo:** Construir a plataforma de e-commerce completa (loja pública + painel administrativo) com dados reais de configuração pendentes substituídos por valores padrão (*defaults*), de forma que o desenvolvimento NUNCA fique bloqueado por falta de informação do cliente.

> **Regra geral:** sempre que uma configuração real (chave de API, gateway de pagamento, domínio, transportadora, etc.) ainda não tiver sido fornecida pelo cliente, o agente deve implementar com um valor/mock padrão documentado na seção 9, marcar o ponto no código com o comentário `// TODO-CLIENTE:` e registrar o item na tabela de pendências (seção 10). Assim que o dado real chegar, o projeto deve ser atualizado sem exigir refatoração estrutural.

---

## 1. Stack Técnica (padrão, salvo indicação contrária)

| Camada | Tecnologia padrão |
|---|---|
| Frontend loja | Next.js (React) + Tailwind CSS |
| Painel admin | Next.js (rota separada `/admin`) + Tailwind CSS |
| Backend/API | Node.js (Next API Routes ou Express separado) |
| Banco de dados | PostgreSQL |
| ORM | Prisma |
| Autenticação | JWT + cookies httpOnly (admin e cliente separados) |
| Upload de imagens | Armazenamento local `/uploads` em dev; S3-compatible em produção (default: MinIO local até credencial AWS ser fornecida) |
| Pagamento | Mock/Sandbox (seção 9) até gateway real ser definido |
| E-mail transacional | Provedor mock em dev (log no console) até SMTP real ser fornecido |
| Hospedagem | Ambiente local/Docker até domínio e servidor serem definidos |

Se o cliente ou a equipe já tiver stack definida, substituir esta tabela antes de iniciar — o restante do documento é independente de tecnologia específica.

---

## 2. Estrutura Geral do Projeto

```
/ecommerce-platform
  /apps
    /storefront      -> loja pública (cliente final)
    /admin           -> painel administrativo
    /api             -> backend/API compartilhada
  /packages
    /database        -> schema Prisma, migrations, seeds
    /ui              -> componentes compartilhados
    /config          -> configurações e defaults centralizados
```

Centralizar TODAS as configurações sensíveis/pendentes em `/packages/config` (arquivo `defaults.ts` + `.env.example`), nunca espalhar valores mockados pelo código.

---

## 3. Loja Pública (Storefront) — Páginas e Funcionalidades

### 3.1 Página inicial
- Banner principal (carrossel) — usar imagens placeholder padrão até o cliente enviar banners reais
- Vitrine de produtos em destaque
- Categorias em destaque
- Seção institucional curta ("Sobre a empresa") — texto placeholder até receber o conteúdo real (ver checklist já entregue)

### 3.2 Área de produtos
- Listagem de produtos com paginação e filtros (categoria, preço, disponibilidade)
- Ordenação (menor preço, maior preço, mais vendidos, lançamentos)
- Busca por nome/SKU
- Página de detalhe do produto:
  - Galeria de imagens (múltiplas fotos)
  - Variações (tamanho, cor, etc.) com atualização de preço/estoque dinâmica
  - Descrição, especificações técnicas
  - Cálculo de frete estimado (CEP) — usar tabela de frete fictícia padrão até integração com transportadora real
  - Botão "Adicionar ao carrinho"
  - Produtos relacionados

### 3.3 Carrinho de compras
- Adicionar, remover, alterar quantidade
- Aplicar cupom de desconto (estrutura pronta; cupons reais cadastrados depois via admin)
- Cálculo automático de subtotal, frete e total
- Persistência do carrinho (cookie/localStorage para visitante; vinculado à conta se logado)

### 3.4 Checkout
- Etapas: (1) Identificação/login ou compra como convidado → (2) Endereço de entrega → (3) Frete → (4) Pagamento → (5) Confirmação
- Formas de pagamento: estrutura pronta para cartão, Pix e boleto, todas operando em **modo sandbox/mock** (seção 9) até o gateway real ser configurado
- Cálculo de frete real via API da transportadora — usar tabela fixa padrão (frete grátis acima de R$ 0,00 como placeholder neutro) enquanto a regra real não for definida
- Página de confirmação do pedido + envio de e-mail transacional (mock em dev)

### 3.5 Conta do cliente
- Cadastro/login (e-mail e senha; estrutura pronta para login social, desativado por padrão)
- Histórico de pedidos e status
- Edição de dados cadastrais e endereços
- Lista de desejos (wishlist) — opcional, incluir como flag desativável

### 3.6 Institucional
- Política de trocas e devoluções (texto placeholder)
- Perguntas frequentes (estrutura pronta, conteúdo placeholder)
- Contato (formulário + dados da empresa placeholder)

---

## 4. Painel Administrativo

### 4.1 Autenticação e permissões
- Login separado do cliente final
- Perfis de acesso: Administrador (acesso total), Operador (produtos e pedidos), Marketing (campanhas e conteúdo) — implementar estrutura de permissões (RBAC) mesmo que inicialmente só exista o perfil Administrador

### 4.2 Dashboard (visão geral)
- Cards de indicadores: vendas do dia/mês, ticket médio, pedidos pendentes, produtos com estoque baixo
- Gráfico de vendas por período (linha) — dados reais assim que houver movimentação; usar dataset de demonstração até então
- Gráfico de produtos mais vendidos (barras)
- Lista de últimos pedidos com status

### 4.3 Gestão de produtos
- CRUD completo de produtos (criar, editar, ativar/desativar, excluir)
- Upload múltiplo de imagens por produto
- Gestão de categorias e subcategorias
- Gestão de variações (tamanho, cor, etc.) e estoque por variação
- Importação em massa via planilha (CSV/XLSX) — compatível com o modelo já usado no checklist entregue ao cliente
- Alertas de estoque baixo (limite configurável, padrão: 5 unidades)

### 4.4 Gestão de pedidos
- Listagem com filtros por status (pendente, pago, em separação, enviado, entregue, cancelado)
- Detalhe do pedido: itens, cliente, endereço, pagamento, histórico de status
- Atualização manual de status e inserção de código de rastreio
- Emissão de nota fiscal — estrutura pronta, integração real com emissor fiscal pendente de definição (item de pendência)

### 4.5 Gestão de clientes
- Listagem e busca de clientes
- Histórico de compras por cliente
- Segmentação básica (novos, recorrentes, inativos)

### 4.6 Marketing e divulgação
- Gestão de cupons de desconto (percentual, valor fixo, frete grátis)
- Gestão de banners/promoções da home
- Painel de integração com pixels (Meta Pixel, Google Ads, GA4) — campos prontos para inserir os IDs reais; até lá, permanecem vazios/desativados sem quebrar o site
- Disparo de e-mail marketing (integração com provedor a definir — estrutura pronta, envio mockado em dev)
- Relatório simples de origem de tráfego (UTM tracking) já estruturado no banco de dados

### 4.7 Relatórios e análise de dados
- Relatório de vendas por período, categoria e produto (exportável em CSV)
- Relatório de desempenho de cupons/campanhas
- Relatório de abandono de carrinho
- Base pronta para conectar futuramente a uma ferramenta de BI (Power BI/Data Studio) via exportação ou API

### 4.8 Configurações gerais
- Dados da empresa (logotipo, cores, textos institucionais) — editáveis via painel, pré-preenchidos com placeholders
- Formas de pagamento habilitadas
- Regras de frete
- Usuários e permissões do painel

---

## 5. Modelo de Dados (entidades mínimas)

`Produto`, `Categoria`, `Variação`, `Estoque`, `Cliente`, `Endereço`, `Pedido`, `ItemPedido`, `Pagamento`, `Cupom`, `Banner`, `UsuárioAdmin`, `LogAuditoria`

Cada entidade deve ter `createdAt`/`updatedAt` e soft delete (`deletedAt`) para permitir histórico e recuperação.

---

## 6. Integrações — status e ordem de implementação

| Integração | Status até receber dado real | Prioridade |
|---|---|---|
| Gateway de pagamento | Sandbox (seção 9) | Alta |
| Cálculo de frete/transportadora | Tabela fixa padrão | Alta |
| Emissor de nota fiscal | Não implementado, apenas botão desativado | Média |
| E-mail transacional (SMTP) | Log em console/arquivo | Alta |
| E-mail marketing | Não conectado, estrutura pronta | Média |
| Pixels de rastreamento (Meta/Google) | Campos vazios, script condicional | Média |
| Login social | Desativado por padrão | Baixa |
| Domínio e hospedagem definitivos | Ambiente local/staging | Alta (antes do lançamento) |

---

## 7. Design e Identidade Visual

- Usar como padrão temporário: cor primária `#9E2BBA`, cor de destaque `#B08D57`, fonte `Inter` ou `Calibri`
- Assim que o cliente fornecer manual de marca/logotipo (conforme checklist já enviado), substituir tokens de cor, fonte e logotipo no arquivo central de tema (`/packages/ui/theme.ts`), sem necessidade de alterar componentes individualmente

---

## 8. Ambiente e Deploy

- Desenvolvimento local via Docker Compose (banco, storefront, admin, API)
- Ambiente de staging para validação do cliente antes da publicação
- Produção: domínio, servidor e certificado SSL a definir junto ao cliente (ver checklist)

---

## 9. Valores Padrão (defaults) enquanto dados reais não são fornecidos

- **Pagamento:** modo sandbox do gateway escolhido como referência de desenvolvimento (ex.: ambiente de testes do Mercado Pago/Stripe), sem transações reais
- **Frete:** tabela fixa fictícia (ex.: R$ 20 fixo, frete grátis acima de R$ 300) — claramente sinalizada como temporária
- **E-mail:** transacional registrado em log, sem envio real
- **Textos institucionais:** placeholders com aviso `[TEXTO PENDENTE DO CLIENTE]`
- **Imagens:** placeholders neutros (sem marcas de terceiros)
- **Domínio:** `localhost` / ambiente de staging interno

---

## 10. Tabela de Pendências do Cliente (atualizar conforme itens forem recebidos)

| Item pendente | Bloqueia o quê | Status |
|---|---|---|
| Logotipo e manual de marca | Identidade visual final | Pendente — estrutura pronta (`packages/ui/theme.ts`, tokens de cor/fonte) |
| Catálogo de produtos completo | Carga real de produtos | Pendente — CRUD + importação CSV prontos (seed de exemplo) |
| Gateway de pagamento definido + credenciais | Checkout em produção | Pendente — sandbox/mock ativo (`PAYMENT_DRIVER=mock`) |
| Transportadora/regras de frete | Cálculo de frete real | Pendente — tabela fictícia R$ 20 / grátis ≥ R$ 300 (`// TODO-CLIENTE`) |
| Domínio e hospedagem | Publicação definitiva | Pendente — ambiente local + Docker |
| Contas Google/Meta Ads | Pixels e campanhas | Pendente — painel pronto em `/admin/configuracoes` (IDs vazios = sem script) |
| SMTP para e-mail transacional | E-mails reais ao cliente final | Pendente — driver mock loga no console (`EMAIL_DRIVER=mock`) |
| Textos institucionais / FAQ / contato | Conteúdo oficial | Pendente — páginas com `[TEXTO PENDENTE DO CLIENTE]` |
| Cupons de campanha reais | Marketing | Estrutura pronta (seed: `BEMVINDO10`, `FRETEGRATIS`, `DIVINE30`) |
| Emissor de nota fiscal | Emissão de NF | Pendente — botão desativado no detalhe do pedido |

> Esta tabela deve ser atualizada a cada nova informação recebida, e o item correspondente no código (marcado com `// TODO-CLIENTE:`) deve ser substituído pela configuração real, sem necessidade de reescrever a funcionalidade.
>
> **Status da implementação:** todas as funcionalidades das seções 1–9 estão implementadas com os defaults/mocks da seção 9 (ver `README.md` para a árvore de arquivos e comandos).

---

## 11. Critério de "pronto para produção"

O projeto só deve ser considerado apto ao lançamento quando **todos os itens da seção 10 estiverem com status "Concluído"** e os defaults da seção 9 tiverem sido substituídos por configurações reais e testadas.
