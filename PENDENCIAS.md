# Pendências do dono da loja

Tudo aqui depende de decisão, conteúdo ou credencial do dono. Nada é placeholder no site: o que não está configurado, não é renderizado.

## Status por escopo (atualizado em 2026-09-30)

### 1. Header & Autenticação

**Status:** Funcionalidades de layout validadas via JWT forjado. Fluxo de logout mockado com sucesso. Pendente credenciais reais para homologação fim a fim.

- Link **Painel Admin** visível apenas para `ADMIN`/`OPERATOR`/`MARKETING` (mesmos roles que o middleware aceita em `/admin`); **Minha conta** e **Sair** para qualquer usuário logado — desktop e drawer mobile.
- Testes automatizados (`admin-header.test.ts`): ADMIN vê os dois links; CLIENT vê só "Minha conta"; deslogado vê nenhum; clicar em "Sair" faz `POST /api/auth/logout` e volta ao estado deslogado.
- Homologação em browser real (1280px) com sessão montada por JWT forjado: admin vê os dois links lado a lado, cliente vê só "Minha conta", logout apaga o cookie de sessão nos dois casos.
- **Pendente:** credenciais reais para o ciclo completo (input → banco → cookie real → redirect → logout). O `seed.ts` cria `admin@divinecloset.com` / `cliente@divinecloset.com`, mas esses usuários **não existem** no banco remoto — enquanto as credenciais oficiais não forem injetadas em `.env.local`, o login real retorna 401.

### 2. Carrossel de Precificação

**Status:** Ajustes de usabilidade desktop identificados e corrigidos (correção do seletor das setas para o track e redistribuição do snap-start para as tags `<Link>`).

- Commit `595f02d` — **setas**: o bloco nunca renderizava (page.tsx é server component; `typeof window !== "undefined"` é falso no SSR) e o `querySelector('[overflow-x="auto"]')` referenciava atributo inexistente. Extraído para client component `CarrosselCategorias.tsx` com `useRef`; cards ganharam largura fixa `w-44` (antes 70–172px irregulares e sem overflow em desktop). Validado: seta avança 300px, volta, e não aparece em mobile.
- Commit `b868361` — **snap**: `carousel-card` removido da div wrapper (ponto único de snap) e aplicado a cada `<Link>` de categoria. Validado em 375px: o swipe para exatamente na borda do card (184px = largura + gap).
- **Pendente do dono:** fotos nas categorias — hoje todas com `image = null` (fallback de letra).

### 3. Otimização de SEO

**Status:** Entregue e commitado (`ac197cd`).

- Titles templateados, canonical, Open Graph, JSON-LD (Organization no layout, Product na PDP), `sitemap.ts`, `robots.ts`, noindex + header `X-Robots-Tag` em páginas privadas, alt automático e lazy-loading.
- **Pendente:** meta title/description próprios dos 19 produtos (conteúdo do dono — ver Tarefa 8 no fim deste arquivo).

### 4. Conformidade LGPD

**Status:** Entregue e commitado (`ac197cd`).

- `ConsentBanner` no layout (aviso de coleta de dados/cookies), página `/privacidade`, noindex das páginas transacionais.
- **Pendente:** revisão do conteúdo da política de privacidade pelo responsável jurídico do dono (o texto atual é o entregue no escopo do projeto).

---

## Pendências de conteúdo e decisão do dono

## 🔴 Alta — catálogo e vendas

### Avaliações (Tarefa 11)
- Fluxo completo no ar (elegibilidade, moderação, convite pós-compra por e-mail 7 dias após entrega).
- WhatsApp no convite e nos avisos: sem integração — só e-mail por enquanto.
- Cron Vercel (`/api/cron/avaliacoes`, diário 12h UTC): exige `CRON_SECRET` igual nos dois lados; no Hobby, verificar limite de execuções.

### Fotos dos produtos (Tarefa 10)
- Manter 4–5 fotos por produto (a principal é a primeira; ordem ajustável no admin).
- Vincular cada foto à sua cor no admin para a galeria pular automaticamente ao trocar de cor.
- Vídeo curto na galeria: estrutura não implementada (sem demanda por enquanto).

### Guia de medidas (Tarefa 9)
Estrutura pronta (admin → Medidas): criar tabelas por modelagem e vincular a produtos ou categorias. Sem tabela vinculada, o link "Guia de medidas" fica oculto na loja. Prioridade: 1 tabela "Feminino adulto" (busto/cintura/quadril) como fallback das categorias principais.

### Conteúdo dos produtos (Tarefa 8)
Os 19 produtos ativos estão sem composição, medidas, dados de modelo e descrição própria (só têm o texto genérico do mock). Completar em admin → Produtos → editar cada um:
- Composição do tecido, instruções de lavagem, comprimento, caimento, ocasião
- Modelo: altura + tamanho que veste (aparece na PDP como "Modelo: 1,75 m, veste M")
- Descrição própria com 300–600 caracteres; meta title (~60) e meta description (140–160) para SEO
- Tabela de medidas: estrutura pronta na Tarefa 9 — vincular por produto ou categoria

### Slugs com sufixo numérico (Tarefa 2)
Ver `relatorio-duplicatas.md` (gerado por `npm run audit:slugs`).
- [ ] **Renomear órfãos** (base apagada, slug limpo livre): `conjunto-alicia-2` → `conjunto-alicia`, `conjunto-melissa-2` → `conjunto-melissa`, `vestido-pietra-2` → `vestido-pietra`. Onde: admin → Produtos → editar → campo slug. Criar redirect 301 do slug antigo (tabela `SlugRedirect` ou admin).
- [ ] **Caso emaranhado**: slug `calca-jeans-mavi` pertence hoje ao produto renomeado "Conjunto Saia & Top", enquanto `calca-jeans-mavi-2` é a "Calça Jeans Mavi" original. Decidir: (a) corrigir o slug do conjunto para `conjunto-saia-top` + redirect do antigo; (b) mesclar os dois produtos. Sem pedidos associados a nenhum dos dois (exclusão simples é segura se preferir apagar um).
- [ ] Regra geral: ao cadastrar produto com nome repetido, o admin agora **avisa** em vez de criar sufixo silencioso — escolha outro nome/slug na hora.

### 🟡 Sistema de Precificação — status atual (2026-09-29, corrigido e validado)

#### O que já funciona (não depende da vendedora):
- Módulo puro `lib/precificacao` com 28 testes (cadeia completa 300+35,96÷17 → R$ 20,00 → R$ 39,99).
- Migration aplicada: `lotes_compra`, `config_precificacao`, `materiais_embalagem` + 8 campos em produtos.
- Telas admin: `/admin/precificacao` (regras, materiais, preview ao vivo) e `/admin/lotes` (CRUD + cálculo em tempo real).
- Bloco "Precificação" no cadastro/edição de produto, com "Usar preço sugerido" e painel lucro/markup/margem.
- Lista de produtos com colunas custo/lucro/margem, filtros e recálculo com diff + confirmação.
- API pública e HTML da loja não expõem custos (teste automatizado `produto-publico.test.ts`).

#### Pendências da vendedora (precisam ser preenchidas):
- **Custos reais de embalagem**: sacola, papel de embrulho, tag e cartão estão cadastrados com custo 0 — preencher em admin → Precificação.
- **Confirmação da regra de embalagem**: hoje `embalagem_entra_no_markup = true` (ganho sobre tudo). Confirmar ou desmarcar.
- **Regra de arredondamento do custo**: hoje `inteiro_para_cima`. Confirmar.
- **Margem mínima**: hoje sem limite (null). Definir, se quiser alertas.
- **Taxas de pagamento**: hoje sem taxa (null). Informar, se quiser lucro real líquido.
- **Lotes anteriores**: cadastrar em admin → Lotes, se quiser histórico.

## 🟡 Média — Operações

### Carrinho abandonado
- Estrutura pronta, porém disparo por e-mail ainda não configurado (precisa de `EMAIL_DRIVER=smtp` e credenciais).

### Login Google
- Botão configurável no admin, porém chaves OAuth ainda não geradas.

### Integração com ERP/envio
- Webhooks para transportadoras ainda em estudo.

## 🟢 Baixa — Aparência e Conteúdo

- Completo: SEO, titles, canonical, og:image, sitemap, robots.txt.
- Pendente: descrições próprias dos 19 produtos, fotos profissionais, conteúdo da página "Sobre nós".