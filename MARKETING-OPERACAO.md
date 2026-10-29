# Marketing Divine Closet — implementação e operação

## Escopo e origem

Base de produção verificada: `b7b23d256f6d1a29a6ba955b6e5000a1f29edf5c`.
O PR #21 original existe: head `1069cfc8b4968084a2422147ce70160ed614f36f`.
O SHA repetitivo do relatório local não era um SHA real. A branch original continha o
checkout do PR #18 e não continha #19/#20. A correção integra o main e restaura os
arquivos exclusivos de #18; o checkout em draft permanece separado. Campos e ícones
sociais publicados são preservados.

## Recursos

- Configurações: teste individual distingue mock, aceitação do provedor e falha,
  rate-limit persistido 5/min/admin e auditoria sem conteúdo/tokens. Erros do
  transporte são sanitizados. Aceitação não comprova entrega na caixa postal.
- Rodapé: inscrição exige e-mail e consentimento explícito; origem/versionamento e
  timestamp são definidos pelo servidor. Cadastro não confirmado não entra em campanha.
- Cadastro/cancelamento: `GET` não altera estado; confirmação e cancelamento só por
  `POST`. Confirmação de posse expira em 24h e é consumida; cancelamento é idempotente.
- Repetir cadastro não reativa cancelados; checkbox de reativação solicita NOVA
  confirmação, mantendo supressão até confirmar. Reenvio tem cooldown de uma hora.
- Resposta pública de cadastro é genérica, inclusive no limite. Limites: IP 10/h,
  endereço 3/h, persistidos no PostgreSQL; chaves de IP/e-mail em SHA-256. Mesma
  resposta não significa garantia de tempo constante contra enumeração.
- Tokens HMAC SHA-256 separados por finalidade, sem e-mail na URL. Usa
  `NEWSLETTER_SECRET` ou `JWT_SECRET` de pelo menos 32 caracteres. Rotação invalida
  links anteriores. Token de confirmação usa nonce e expiração; descadastro usa
  versão própria duradoura. Os links ficam apenas nas mensagens privadas da fila.
- As tabelas NewsletterSubscriber, MarketingCampaign e MarketingMessage têm RLS,
  privilégios públicos revogados e CRUD por divine_app. Aplicação atual conecta
  como postgres; não há troca de role nesta entrega.
- /admin/marketing/campanhas: rascunho, edição, prévia em TEXTO simples (React escapa
  HTML), público por origem de consentimento ou todos os confirmados, contagem,
  confirmação explícita de enfileiramento, histórico e cancelamento.
- Campanha tem no máximo 1000 destinatários por operação nesta versão. Se a
  contagem mudar entre prévia e confirmação, a API rejeita e exige nova prévia.
- Teste individual usa a seção de configurações, separada de campanhas.

## Fila e processamento

A inscrição grava confirmação e assinante na mesma transação. Campanhas usam chave
única `campaign:campanha:assinante`; confirmar duas vezes não duplica destinatários.
Não há novo cron, agendamento ou ativação automática. **Confirmações e campanhas
aguardam processamento manual pelo admin**, até 10 mensagens por operação; o botão
informa que o transporte ativo enviará mensagens reais. Para ativar futuramente,
definir uma rotina compatível com o plano e com o volume. A confirmação pode expirar
se não processada em 24h; usuário pode solicitar novo link após cooldown.

`mock` não chama o transporte nem marca aceitação. O worker faz claim durável como
REVIEW antes do envio e usa transação com locks na ordem campanha → assinante →
mensagem. Revalida supressão imediatamente antes de enviar. O cancelamento/descadastro
espera um envio já iniciado terminar; não desfaz uma mensagem já aceita pelo provedor.
Sem perda da conexão, dois workers não enviam a mesma mensagem.

Estados: PENDING, ACCEPTED, SUPPRESSED, CANCELLED, FAILED, REVIEW. REVIEW também é o
claim durante processamento e permanece se houver queda/timeout incerto. Não há
recuperação automática de REVIEW: verificar provedor antes de qualquer ação manual.
Nunca presumir “não enviado” só porque o banco não marcou ACCEPTED.

Resend recebe chave estável e payload imutável. Falha transitória conhecida retenta
com backoff (4/8/16/32 minutos; máximo 5 tentativas). Janela conservadora de 23h desde
primeiro claim: depois disso exige REVIEW, pois a idempotência do provedor tem limite.
Erro permanente vira FAILED. SMTP incerto vira REVIEW, sem repetição automática:
SMTP não oferece garantia de deduplicação. Não há promessa de exactly-once entre
banco e provedor; rollback após aceite é uma situação operacional incerta.

E-mails transacionais da loja continuam no outbox existente e não dependem da
inscrição em marketing. A recuperação de carrinho existente não foi convertida em
campanha nesta rodada: consentimento para essa rotina exige revisão específica antes
de ampliar seu uso promocional. Não confundir as duas filas.

## Indicadores

/admin/marketing exige ADMIN, assim como APIs. Período usa Order.createdAt e dias
civis de America/Sao_Paulo (UTC-3 nas datas suportadas). Não representa data efetiva
de liquidação: o modelo atual não tem paidAt confiável.

- Pedidos pagos/bruto: soma Decimal de Order.total com paymentStatus PAID ou REFUNDED.
- Estornos: somente Refund.status APPROVED da MESMA coorte de pedidos, mesmo que o
  estorno tenha sido resolvido depois do período. Não subtrair novamente do bruto
  excluindo os pedidos REFUNDED. Sem Refund aprovado não se inventa valor estornado.
- Após estornos = bruto menos estornos; não é lucro nem fluxo de caixa.
- Ticket = bruto / quantidade de pedidos pagos ou estornados.
- Origem: agrupa source/medium/campaign; ausência vira desconhecida.
- Exclusão de testes: lista explícita de números no filtro, até 100. Não há marcador
  histórico confiável para excluir automaticamente e nenhum dado foi reclassificado.
- Assinantes/campanhas: totais atuais, não a coorte do período financeiro.
- Mensagens aceitas ≠ entregas, aberturas ou cliques. Não existe taxa de conversão
  por visitas, pois não há denominador confiável no banco.
- Modelo atual tem um Refund por pedido. Soma usa o amount aprovado, inclusive se
  parcial; esta entrega não implementa estorno parcial nem altera o fluxo financeiro.

## Analytics (entrega separada)

Implementação separada da base de newsletter/campanhas: consentimento e revogação,
UTM e view_item/add_to_cart/begin_checkout/purchase. Eventos GA4 usam gtag e Meta usa
fbq, não apenas objetos soltos em dataLayer. Eventos não contêm dados de cliente.
URLs de acompanhamento, newsletter e admin não carregam tracking. Querystring não
é enviada explicitamente a GA4; Meta usa o SDK externo e sua recepção real não foi
validada nesta rodada.

Conversão exige POST autorizado ao servidor: sessão do dono, token privado guest
válido ou posse da chave UUIDv4 secreta do checkout, junto ao número. E-mail e número
sozinhos não autorizam. A prova guest é guardada em sessionStorage por uma hora;
ninguém envia essa chave ao analytics. Pedidos pendentes, cancelados, estornados ou
em hold não convertem. Total/itens vêm do banco; URL não comprova pagamento.
Deduplicação local por pedido só depois de consentimento e emissão; GA4 recebe
transaction_id, Meta eventID. Não há garantia de entrega ao provedor/entre browsers.
Google Ads tem configuração base, mas **conversão Ads não é implementada** sem ação
/label de conversão definida; não inventar identificador.

## Migração e futura publicação

Duas migrações novas em relação ao main: newsletter_subscribers (original) e
marketing_seguro (hardening, fila e campanhas). Não reescrever migrações aplicadas.
Validar em banco vazio e upgrade com dados sintéticos; conferir 34 migrações no
histórico combinado desta branch. Nenhuma migração foi aplicada em produção.

Antes de merge/deploy autorizado: confirmar head/base, revisão do código, backup e
conexão de sessão corretos; aplicar migrações pelo Prisma antes de ativar código.
Confirmar apenas nomes/configuração segura de EMAIL_DRIVER, EMAIL_FROM,
RESEND_API_KEY ou SMTP_*, JWT_SECRET/NEWSLETTER_SECRET, NEXT_PUBLIC_APP_URL. Nunca
imprimir valores secretos. Não alterar variáveis ou drenar filas automaticamente.

Rollback de código não desfaz envio nem desfaz migração. Suspender processamento,
reverter código e preservar tabelas/estado para investigação. Não recriar mensagens
aceitas nem repetir REVIEW sem conferir o transporte.

## Verificação reproduzível

Usar PostgreSQL local descartável e ambiente do script versionado pg-real.mjs, com
PGHOST/PGPORT/PATH/bibliotecas corretos. `npm run test`, typecheck, lint e build.
marketing-pg.test.ts cria banco dedicado local e aplica a cadeia completa. Asserts
cobrem concorrência, supressão, cancelamento durante envio, reativação, RLS,
backoff, erro permanente, simulação e somas financeiras.

scripts/validar-marketing-browser.mjs exige URL e DATABASE_URL locais, módulos de
Playwright/Prisma/jose por variável e Chromium instalado. Todo tráfego externo é
interceptado. As evidências são locais, não CI nem confirmação de entrega externa.
O teste de checkout passou a usar números determinísticos apenas nas fixtures:
colisão aleatória dos 4 dígitos de orderNumber derrubou uma execução. Geração do
número em produção continua igual; melhoria de resistência a colisões fica pendente
separadamente, sem alterar pagamento no escopo de marketing.
