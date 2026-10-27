# Proteção do acesso direto às tabelas

## Correção preparada

A migration `20261027130000_seguranca_acesso_tabelas` ativa RLS e revoga privilégios de `PUBLIC`, `anon` e `authenticated` nas dez tabelas operacionais identificadas na auditoria. Concede à role `divine_app` CRUD e uma policy explícita; não modifica a role `service_role` nem as policies de avaliações. Remove apenas as duas policies provisórias que liberavam `Product` e `lotes_compra` para qualquer sessão autenticada.

## Antes de aplicar

- Confirmar o usuário efetivamente usado pela conexão Prisma em produção e se possui acesso às dez tabelas após RLS. A aplicação pode conectar como `postgres`, `divine_app` ou outra role; somente as duas primeiras foram consideradas. Não registrar credenciais.
- Verificar se há integrações legítimas externas usando a Data API nas dez tabelas ou as policies temporárias. A mudança encerrará esses acessos.
- Conferir que a migration está pendente no histórico Prisma, que o backup e o procedimento de recuperação são adequados e que o SQL foi testado na mesma versão disponibilizada.
- Executar primeiro em banco PostgreSQL descartável: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database/tests/seguranca-acesso.sql`. O teste cria tabelas e roles e deve rodar somente em banco vazio e descartável, nunca em produção.

## Depois de aplicar

- Verificar RLS, grants efetivos e advisors; confirmar com requisições de leitura sem dados que as dez tabelas não estão acessíveis por `anon`. Conferir também o acesso de `authenticated` usando uma identidade de teste autorizada.
- Validar catálogo, avaliações aprovadas, checkout sem pagamento real, acompanhamento e operações administrativas e da fila. Não acionar crons que enviem notificações, drenem filas ou façam operações financeiras como parte do smoke.
- Confirmar que o deploy aponta para o código e o banco corretos. O teste isolado não comprova a configuração efetiva da Vercel nem testa integrações externas.

## Limites

Esta migration não altera privilégios padrão para futuras tabelas. Cada nova tabela em schema exposto deve receber RLS e grants na própria migration. Revisar separadamente os privilégios padrão, views, funções e todos os papéis usados pelo projeto. A cópia no schema privado no mesmo banco não substitui backup independente e teste de restauração.

Se houver falha funcional, investigar a role efetivamente usada e conceder apenas o acesso necessário. Não reativar policies permissivas nem desativar RLS como solução genérica; qualquer reversão deve preservar a proteção dos dados.
