# Pendências do dono da loja

Tudo aqui depende de decisão, conteúdo ou credencial do dono. Nada é placeholder no site: o que não está configurado, não é renderizado.

## 🔴 Alta — catálogo e vendas

### Slugs com sufixo numérico (Tarefa 2)
Ver `relatorio-duplicatas.md` (gerado por `npm run audit:slugs`).
- [ ] **Renomear órfãos** (base apagada, slug limpo livre): `conjunto-alicia-2` → `conjunto-alicia`, `conjunto-melissa-2` → `conjunto-melissa`, `vestido-pietra-2` → `vestido-pietra`. Onde: admin → Produtos → editar → campo slug. Criar redirect 301 do slug antigo (tabela `SlugRedirect` ou admin).
- [ ] **Caso emaranhado**: slug `calca-jeans-mavi` pertence hoje ao produto renomeado "Conjunto Saia & Top", enquanto `calca-jeans-mavi-2` é a "Calça Jeans Mavi" original. Decidir: (a) corrigir o slug do conjunto para `conjunto-saia-top` + redirect do antigo; (b) mesclar os dois produtos. Sem pedidos associados a nenhum dos dois (exclusão simples é segura se preferir apagar um).
- [ ] Regra geral: ao cadastrar produto com nome repetido, o admin agora **avisa** em vez de criar sufixo silencioso — escolha outro nome/slug na hora.
