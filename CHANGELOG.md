# Changelog — Divine Closet e-commerce

## [1.1.0] — 2026-10-02 — Fase 2 (correções priorizadas de precificação e cupom)

### 🛡️ Exclusão de produto com histórico preservado (item 1)
- FK `OrderItem → Product` de `Cascade` para `Restrict` (migration + Supabase)
- Excluir com pedido associado desativa (`isActive=false`, `deletedAt`); sem pedido, hard delete liberado
- Botão do admin distingue "Desativar" × "Excluir" com confirmações diferentes

### 🏷️ Desconto sincronizado (item 2 — Opção B via hook do ORM)
- `discountPercent` é derivado via `$extends` do Prisma em toda escrita (admin, CSV, recálculo, seed)
- Cálculo na leitura descartado: o Prisma não expressa `comparePrice > price` no `where` (quebraria paginação de Ofertas)
- Import CSV aceita coluna opcional `preco_de`

### 🛒 Snapshot de preço no carrinho (item 3)
- `CartItem.unitPrice` gravado na adição; checkout revalida e avisa por item ("mudou de R$ A para R$ B", aceitar ou remover)
- `POST /api/pedidos` trava com 409 se houver divergência (nada cobrado silenciosamente)

### 📥 Import CSV com custo (item 4)
- Colunas opcionais `lote_id,lote,custo_peca,markup,custos_extras` gravam os mesmos snapshots do formulário manual
- Sem custo → importa normal e entra na lista `semCusto` do relatório (sem duplicar)
- Lote inexistente cai em `semCusto`, nunca em cálculo silencioso

### 📜 Auditoria de preço (item 5)
- Tabela `historico_preco` (produto, usuário, anterior/novo em centavos, origem, data)
- Log nos 3 caminhos: `edicao_manual`, `recalculo_massa`, `import_csv` (criação com anterior = 0)
- Aba "Histórico de preço" na edição do produto (somente ADMIN)

### 🧮 Cálculo único de total em centavos (item 6)
- `lib/pedidos/calculo-total.ts` usado por `/api/cupom` (exibe) e `/api/pedidos` (grava); half-up no centavo
- Corrigido: `total` usava desconto não-arredondado enquanto o gravado era arredondado (divergência de até 1 centavo)

### 🎫 Elegibilidade de cupom pura + limiares (item 7)
- `lib/elegibilidade-cupom.ts` compartilhada pelas duas rotas (mensagens de erro inalteradas)
- Uso único = `maxUses 1 + usedCount 1` (não há cupom de boas-vindas dedicado, só e-mail)
- Borda inclusiva no mínimo; precedência expiração > mínimo documentada em teste

### 🔧 Consolidação de conversões monetárias (pós-Fase 2)
- `lib/moeda-input.ts` (contrato cliente: vírgula decimal) + `reaisParaCentavos` da lib no servidor
- 9 pontos consolidados; `parseReais` do import mantido (contrato próprio de validação)

### 🧪 Homologação E2E (pedido real + limpeza, resíduo zero)
- Item 2: import com `preco_de` → Ofertas; remoção/edição reflete
- Item 3: aviso no checkout, aceitar, indisponível, remover
- Itens 4/5/8: CSV com/sem custo, 3 origens de log, mesmos centavos pós-consolidação
- Item 6: cupom PERCENT (dízima 33,33→3,33); item 7: cupom FIXED + frete grátis — exibido == gravado

### 📊 Impacto
- 12 commits (10 da Fase 2 + 2 da consolidação monetária)
- 0 breaking changes (mensagens/status das APIs preservados)
- Suíte: 164 testes em 23 arquivos, todos passando; typecheck e build limpos
