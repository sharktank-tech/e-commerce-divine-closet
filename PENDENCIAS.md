# Pendências do dono da loja

Tudo aqui depende de decisão, conteúdo ou credencial do dono. Nada é placeholder no site: o que não está configurado, não é renderizado.

## 🔴 Alta — catálogo e vendas

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
