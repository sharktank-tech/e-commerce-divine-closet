# Provador virtual — protótipo Divine Closet

Esta implementação pertence **exclusivamente** ao repositório `sharktank-tech/e-commerce-divine-closet`, desenvolvido em Next.js (App Router). Não tem relação com PolloModas.

## Funcionamento
- Na página de um produto com imagem, a cliente vê o provador virtual.
- A foto é enviada como data URI pelo navegador para `POST /api/provador`, após consentimento explícito.
- O servidor consulta o produto pelo ID no banco e utiliza sua primeira imagem pública HTTPS, evitando que o navegador escolha uma URL arbitrária.
- A chave FASHN fica exclusivamente no servidor. `tryon-v1.6` inicia a geração e `GET /api/provador/[id]` consulta o andamento.
- A imagem gerada aparece na página, com opção de salvamento. Sem chave, o endpoint responde 503.
- Nenhuma imagem pessoal é gravada intencionalmente no banco ou storage da loja. A FASHN recebe a imagem para o processamento; revisar seu contrato e retenção de dados antes de liberar ao público.

## Configuração
Defina `FASHN_API_KEY` no ambiente do app web, sem prefixo `NEXT_PUBLIC_`. Execute `npm install`, `npm run typecheck` e `npm run build` na raiz do monorepo. Teste em staging.

## Atenção antes da produção
**O protótipo não está liberado para deploy de produção.** Implementar limites por sessão/IP, quota de requisições, controle de custo, validação de origem e proteção contra automação antes de usar créditos reais em escala. Validar também os formatos de imagem e a política de consentimento/LGPD com assessoria jurídica. As imagens geradas são ilustrativas e não prometem medidas ou caimento exato.

Documentação: https://docs.fashn.ai/api-reference/tryon-v1-6
