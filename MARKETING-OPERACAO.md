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

PR dependente da base de newsletter/campanhas: consentimento e revogação,
UTM e view_item/add_to_cart/begin_checkout/purchase. Eventos GA4 usam gtag e Meta usa
fbq, não apenas objetos soltos em dataLayer. Eventos não contêm dados de cliente.
URLs de acompanhamento, newsletter e admin não carregam tracking. Querystring não
é enviada explicitamente a GA4; Meta usa o SDK externo e sua recepção real não foi
validada nesta rodada.

Conversão exige POST autorizado ao servidor: sessão do dono, token privado guest
válido ou posse da chave UUIDv4 secreta do checkout, junto ao número. E-mail e número
sozinhos não autorizam. A prova guest só é guardada com consentimento, em sessionStorage, por uma hora;
o servidor também limita seu uso à primeira hora do pedido;
ninguém envia essa chave ao analytics. Pedidos pendentes, cancelados, estornados ou
em hold não convertem. Total/itens vêm do banco; URL não comprova pagamento.
Deduplicação local por pedido só depois de consentimento e emissão; GA4 recebe
transaction_id, Meta eventID. Não há garantia de entrega ao provedor/entre browsers.
Google Ads tem configuração base, mas **conversão Ads não é implementada** sem ação
/label de conversão definida; não inventar identificador.

## Migração e futura publicação

Criação e proteção das novas tabelas ocorrem na mesma transação: não há janela
de acesso público entre CREATE TABLE e REVOKE/RLS. A migração original de newsletter
ainda não publicada foi endurecida; nenhuma migração aplicada em produção foi editada.

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


## Evidências desta rodada

- Base do PR #21: main b7b23d2; head remoto após revisão: ff2f18d.
- Núcleo de newsletter/campanhas: 579 testes/57 arquivos e 12 asserts Chromium.
- Composição com analytics e hardening transacional: 587 testes/59 arquivos, sem
  skips ou falhas; 21 asserts Chromium 153, com chamadas externas interceptadas.
- Typecheck e lint sem erros, build Next de produção local aprovado.
- Cadeia de 34 migrações aplicada em bancos descartáveis; upgrade desde main
  preservou pedido, contador de cupom e assinante. RLS/42 negações verificadas.
- São verificações locais; não há alegação de CI verde nem recepção real no provedor.


## Revisão antes da publicação

A confirmação de enfileiramento inclui hash da versão exata de assunto/conteúdo/
segmento e updatedAt. Prévia antiga é rejeitada, mesmo se a contagem for igual.
Enfileiramento trava os assinantes em ordem e recarrega elegibilidade. Somente
confirmados com consentimento registrado na versão vigente são incluídos. Descadastro
suprime mensagens antigas pendentes ou já reivindicadas, sob a mesma trava do
assinante; reativar depois não ressuscita campanhas anteriores. Mock do teste
individual não chama transporte nem imprime o corpo em log.

SDKs já carregados recebem consentimento negado ao revogar ou entrar em rota
privada. A revogação remove também provas temporárias de conversão. Google signals
e personalização de anúncios permanecem desabilitados nesta implementação.


## Auditoria operacional complementar — 29/10/2026

### Escopo e evidência verificada
- PR #21 integrado em main: merge `465d0d1f819368ee615982553cdb8c34ae096482`.
- PR #22 integrado em main: merge `e763ed12df749f3cbaad70772da1ed07b606061b`.
- Descrições dos PRs registram deploy Vercel bem-sucedido, migrações aplicadas e smoke público sem escritas. Não representam nova execução nesta auditoria.
- Revisão de código em main: `api/newsletter/subscribe` exige consentimento e versão válidos; confirmação e descadastro só alteram estado via POST; `api/admin/marketing/email` exige ADMIN, rate-limit e diferencia mock/accepted/failed; `drainMarketing` é manual, máximo 10 por chamada, com claim REVIEW, supressão e tratamento conservador de falha incerta.
- Nenhum envio de campanha, criação de inscrição, compra ou mudança de variável foi realizado nesta auditoria.

### Checklist dos cinco pontos
1. **Variáveis e ambiente — PARCIAL/BLOQUEADO:** projeto `e-commerce-divine-closet-web` localizado na listagem de projetos Vercel; leitura de metadados das variáveis retornou 404 e listagem de deployments 403. Não se comprovou neste acesso quais integrações estão configuradas. Repetir auditoria de nomes/escopos, sem revelar valores: `EMAIL_DRIVER`, `EMAIL_FROM`, `RESEND_API_KEY` ou `SMTP_*`, `NEWSLETTER_SECRET` (ou `JWT_SECRET`), `NEXT_PUBLIC_APP_URL`, IDs públicos de GA4/Meta. Verificar domínio de envio, SPF/DKIM/DMARC no provedor.
2. **Newsletter — CÓDIGO VERIFICADO; E2E REAL PENDENTE:** testar com caixa de e-mail própria e consentimento explícito, processando uma confirmação manualmente; verificar token expirar/ser de uso único, descadastro, reativação somente após nova confirmação e ausência de inclusão indevida em campanhas. Não usar e-mails de terceiros.
3. **Analytics — CÓDIGO/TESTES ANTERIORES VERIFICADOS; RECEPÇÃO REAL PENDENTE:** validar GA4 DebugView e Meta Test Events, sem PII, em navegação consentida e depois revogada; checar eventos `view_item`, `add_to_cart`, `begin_checkout`; `purchase` somente com pedido pago real/autorizado. Ads conversion label não definida, portanto não declarar Google Ads finalizado.
4. **Fila/logs — CÓDIGO/TESTES ANTERIORES VERIFICADOS; RUNTIME PENDENTE:** consulta de runtime logs Vercel falhou com 403; nenhuma fila foi drenada. Auditar contagem por status `PENDING`, `REVIEW`, `ACCEPTED`, `FAILED`, `SUPPRESSED`, `CANCELLED` por canal e janela, sem dados pessoais; investigar REVIEW junto ao provedor antes de retentar. Não habilitar cron nem processamento automático sem decisão explícita.
5. **Evidências/runbook — DOCUMENTADO:** esta seção guarda as verificações, limites e ações necessárias, sem chamar pendências externas de sucesso.

### Critério para encerrar a infraestrutura operacional
Aprovar somente após: (a) leitura autorizada dos metadados de ambiente/deploy e logs sem exposição de segredos; (b) confirmação/descadastro real com e-mail controlado; (c) eventos consentidos visíveis nos provedores e revogação respeitada; (d) inspeção de fila e registro de eventuais REVIEW; (e) checklist e evidências datadas. Nenhuma dessas operações exige disparo em massa. O PR #18 e o ERP continuam fora do escopo.

### Adendo de acesso — segunda verificação em 29/10/2026
A consulta Vercel via **nome** do projeto (`e-commerce-divine-closet-web`, sem escopo explícito) permitiu listar **somente metadados** de variáveis, sem descriptografia: `EMAIL_DRIVER`, `EMAIL_FROM`, `RESEND_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `JWT_SECRET` e `NEXT_PUBLIC_APP_URL` estão cadastradas para production. O fallback `JWT_SECRET` está cadastrado; `NEWSLETTER_SECRET` não apareceu nesta verificação. Isso confirma nomes/escopos, **não** valores corretos, domínio verificado ou entrega real. IDs públicos de GA4/Meta/Ads não apareceram sob nomes contendo GA/GTM/META/PIXEL/GOOGLE/ADS na listagem filtrada; eles podem estar em outra fonte de configuração e exigem confirmação pela interface/configuração ativa.

A leitura de metadados do projeto confirmou o identificador e domínio Vercel; na consulta mais recente o deployment de produção estava `BUILDING` (possível atualização relacionada ao commit de documentação). Não declarar essa nova implantação como `READY` sem consultar novamente. Acesso às listagens de deployments e aos logs continuou negado (403). Portanto: ponto 1 **parcialmente validado**; pontos 2–4 mantêm pendência de prova real; ponto 5 registrado.


## Homologação adicional — verificação de produção (29/10/2026)

### Confirmado por ferramentas conectadas
- Vercel: projeto `e-commerce-divine-closet-web` acessível. Deployment de produção `dpl_BUu5C5YSQbi8pTAQsq7LWnwcrkNS` para o commit `dead7ee12ca465d56a6fccfad53635a9db1c808c` mudou de BUILDING para READY na consulta posterior. Domínios `divinecloset.com.br` e `www.divinecloset.com.br` vinculados ao projeto. O deploy da documentação não altera o fluxo de marketing.
- Supabase: projeto `Divine Closet` em `ACTIVE_HEALTHY`; as migrations `20261028000000_newsletter_subscribers` e `20261029160000_marketing_seguro` estão registradas como aplicadas.
- PostgreSQL: RLS `relrowsecurity=true` em `NewsletterSubscriber`, `MarketingCampaign`, `MarketingMessage`; nenhuma linha retornada no agrupamento de status das três tabelas (zero assinantes/campanhas/mensagens).
- Tabela `Setting`: chaves `emailMarketing` e `pixels` existentes, sem consulta de dados sensíveis. Na configuração `emailMarketing`, `provider` está vazio e `senderEmail` não está preenchido. Campos `ga4Id`, `googleAdsId` e `metaPixelId` em `pixels` estão vazios.
- Vercel: metadados das variáveis do transporte e autenticação constam em production; não foi feita leitura de valores, portanto `EMAIL_DRIVER` e os segredos não estão validados.
- Os logs de runtime/error clusters Vercel retornaram 403. Supabase disponibilizou fontes agregadas de logs, mas não são substituto dos logs de função da Vercel.
- A página pública da loja pôde ser localizada via ferramenta de navegação, mas endpoints `/api/newsletter/confirm` e `/api/newsletter/unsubscribe` não foram acessíveis por essa ferramenta. Uma tentativa de smoke HTTP em ambiente isolado falhou por resolução DNS, e **não** deve ser descrita como falha do site.
- Nenhuma mutação no Supabase, solicitação real de inscrição, disparo de e-mail ou evento de compra foi realizada.

### Gatilhos restantes de ativação
1. Configurar `emailMarketing.provider` e `senderEmail` coerentes com o transporte de produção; confirmar valor efetivo de `EMAIL_DRIVER` pela interface segura, autenticação e DNS SPF/DKIM/DMARC. Só então testar envio individual para caixa controlada, aceitação no provedor e efetiva recepção.
2. Configurar IDs reais, da titularidade da loja, em `pixels.ga4Id`, `pixels.metaPixelId` e, se usado, `pixels.googleAdsId`; configurar action/label específica para conversão Ads. Depois validar consentimento/revogação e eventos de teste nas interfaces oficiais.
3. Executar inscrição/confirmar/descadastrar com endereço controlado, verificando banco e prova de mensagem, com processamento manual até 10.
4. Restabelecer acesso a logs de runtime Vercel para examinar erros e requisições reais, registrar evidência de estados e verificar filas antes de qualquer dreno.
5. Atualizar este runbook com IDs de execução, timestamps e resultados *sem* tokens, emails reais, URLs privadas de confirmação, credenciais ou dados pessoais.

**Estado:** estrutura de marketing publicada e validada em banco; provedores externos não configurados ou não demonstrados nesta auditoria. **Não declarar homologação operacional concluída.**
