# Divine Closet 👗 E-commerce

Loja de moda online full-stack construída com **Next.js (App Router) + Tailwind CSS + PostgreSQL + Prisma**.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Frontend loja | Next.js + React + Tailwind CSS |
| Painel admin | Next.js (`/admin`) + Tailwind CSS |
| Backend/API | Next API Routes |
| Banco de dados | PostgreSQL |
| ORM | Prisma |
| Auth | JWT + cookies httpOnly (admin e cliente separados) |
| Upload | Local `/uploads` (dev) — S3/MinIO (prod) |
| Pagamento | Mock/sandbox até gateway real |
| E-mail | Mock (log no console) até SMTP real |

## Rodando local

### 1. Suba o PostgreSQL

```bash
docker compose up -d
```

Sem Docker? Basta ter um Postgres rodando e ajustar `DATABASE_URL` no `.env`.

### 2. Instale e configure

```bash
npm install
cp .env.example .env   # ajuste segredos se quiser
npx prisma migrate dev
npm run db:seed
```

### 3. Inicie

```bash
npm run dev
```

- Loja: http://localhost:3000
- Admin: http://localhost:3000/admin/login

## Credenciais do seed

| Perfil | E-mail | Senha |
| --- | --- | --- |
| Admin | admin@divinecloset.com | admin123 |
| Cliente | cliente@divinecloset.com | cliente123 |

> Troque as senhas antes de qualquer uso real.

## Funcionalidades

### Loja
- Home com destaques, categorias e novidades
- Catálogo com busca, filtro por categoria, ordenação e paginação
- Página de produto com variações (tamanho/cor), estoque e relacionados
- Carrinho (persistido para visitante via cookie e para logado via banco)
- Checkout com endereço + pagamento mock
- Conta do cliente com histórico de pedidos
- Cadastro/login/logout (JWT httpOnly)

### Painel admin (`/admin`)
- Dashboard: receita, pedidos, clientes, estoque baixo, status
- CRUD de produtos com upload de imagens
- Gestão de pedidos (atualização de status dispara e-mail mock)
- Lista de clientes com LTV e último pedido
- Rotas protegidas por middleware + verificação de role ADMIN

### Integrações prontas (mock)
- **Pagamento** (`src/lib/pagamento.ts`): cartão `4000*` recusa; demais aprova
- **E-mail** (`src/lib/email.ts`): loga no console; troque `EMAIL_DRIVER`
- **Upload** (`src/lib/upload.ts`): grava em `public/uploads`; plugue S3/MinIO em produção

## Pendências do cliente (`// TODO-CLIENTE:`)

Configs mockadas até o cliente fornecer os dados reais (ver `src/config/defaults.ts` e `Instrucoes_Dev_Ecommerce.md` seção 10):

| Item pendente | Bloqueia o quê | Status |
|---|---|---|
| Logotipo e manual de marca | Identidade visual final | Pendente |
| Catálogo de produtos completo | Carga real de produtos | Pendente |
| Gateway de pagamento + credenciais | Checkout em produção | Pendente (`PAYMENT_DRIVER=mock`) |
| Transportadora/regras de frete | Cálculo de frete real | Pendente (R$ 20 fixo, grátis ≥ R$ 300) |
| Domínio e hospedagem | Publicação definitiva | Pendente |
| Contas Google/Meta Ads | Pixels e campanhas | Pendente (`pixels` vazio) |
| SMTP para e-mail transacional | E-mails reais | Pendente (`EMAIL_DRIVER=mock`) |
| Textos institucionais / FAQ / contato | Conteúdo oficial | Pendente (`[TEXTO PENDENTE DO CLIENTE]`) |
| Cupons de campanha reais | Marketing | Estrutura pronta (seed: `BEMVINDO10`, `FRETEGRATIS`, `DIVINE30`) |
| Emissor fiscal | Nota fiscal | Estrutura/próximo (botão desativado) |

## Comandos úteis

```bash
npm run dev            # desenvolvimento
npm run build          # build de produção
npm run start          # produção
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm run prisma:migrate # migrações dev
npm run db:seed        # seed
npm run db:studio      # Prisma Studio
npm run db:reset       # reset + seed
```

## Deploy na Vercel

Configurações do projeto no dashboard:

- **Root Directory:** `apps/web`
- **Framework Preset:** Next.js (detectado via `apps/web/package.json`)
- **Build Command / Output:** padrão (`npm run build` → `.next`)
- **Install:** padrão — o `package-lock.json` da raiz registra os workspaces e o
  `postinstall` gera o Prisma Client (`packages/database/prisma/schema.prisma`)

Passos obrigatórios:

1. **Banco gerenciado** (Neon, Supabase ou Vercel Postgres) — o `localhost` do `.env`
   não existe na Vercel. Use a URL com pool de conexões (`?pgbouncer=true`).
2. **Migrations em produção** — rode uma vez da sua máquina, apontando para o banco
   de produção:
   ```bash
   DATABASE_URL="<url-producao>" npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
   ```
   Não rode `db:seed` em produção (criaria admin/cliente de exemplo).
3. **Variáveis de ambiente** (Settings → Environment Variables):
   `DATABASE_URL`, `JWT_SECRET` (segredo forte), `NEXT_PUBLIC_APP_URL`,
   `UPLOAD_DRIVER`, `EMAIL_DRIVER` (+ `SMTP_*`), `PAYMENT_DRIVER`.
4. **Uploads:** `UPLOAD_DRIVER=local` não persiste na Vercel (filesystem efêmero).
   Para produção use `UPLOAD_DRIVER=s3` com `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY` (+ `S3_ENDPOINT`/`S3_REGION` para MinIO/Supabase/R2 e
   `S3_PUBLIC_URL` para CDN). O bucket precisa de leitura pública.

## Estrutura

```
prisma/            schema + seed
public/uploads/    imagens locais
src/
  app/             rotas App Router (loja + admin + api)
  components/      ui / layout / loja
  lib/             prisma, auth, email, pagamento, upload, utils
  middleware.ts    proteção de rotas admin/cliente
```

## Produção (checklist)

- [ ] Trocar `JWT_SECRET` por segredo forte
- [ ] Trocar senhas do seed
- [ ] Configurar SMTP real + `EMAIL_DRIVER`
- [ ] Definir gateway de pagamento real
- [ ] Configurar S3/MinIO + `UPLOAD_DRIVER`
- [ ] Rodar `npx prisma migrate deploy` (dev local usou `prisma db push`)
- [ ] Revisar cookies `secure` (já ativos quando `NODE_ENV=production`)
- [ ] Substituir todos os `// TODO-CLIENTE:` pelos dados reais (seção 10 do `Instrucoes_Dev_Ecommerce.md`)
