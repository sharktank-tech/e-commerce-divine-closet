# PostgreSQL REAL local — instalação, variáveis, execução e limpeza

Estado: **versionado nesta rodada** (scripts `pg-real.mjs` e
`upgrade-pg-real.mjs` em `packages/database/scripts/`). Escopo: validação em
checkout limpo — **nunca toca em produção**.

## 0. Por que PostgreSQL "real"

O DB emulado (PGlite) multiplexa todas as conexões numa **única sessão
backend**: transações concorrentes colidem com `42P05` (duplicate key on
pg_class) e não reproduzem a corrida verdadeira. As validações de rebuild/
upgrade de migrações e o teste de concorrência de `ErpEvent.businessKey`
exigem um servidor PostgreSQL de verdade, com conexões independentes.

## 1. Instalação (`setup`)

```bash
node packages/database/scripts/pg-real.mjs setup
```

O que faz, nesta ordem (tudo dentro de `PG_REAL_HOME`, padrão `<repo>/.pg-real`):

1. **Prefixo Alpine** (`PG_ALPINE_PREFIX`, padrão `<PG_REAL_HOME>/alpine`):
   se ainda não existe, instala `postgresql17`, `postgresql17-client`,
   `tzdata` e `nss_wrapper` com **`apk --usermode --root` — sem root e sem
   tocar no sistema** (semeia `<root>/etc/apk/{repositories,keys}` do host
   Alpine; sem esses arquivos o script bloqueia e instrui a apontar
   `PG_ALPINE_PREFIX` para um prefixo já existente). Se o prefixo já existe
   (ex.: `~/.local/pgalpine`), é reaproveitado — nada é baixado.
2. **Binários**: `initdb`, `pg_ctl`, `pg_isready`, `postgres`, `psql` viram
   **symlinks** de `<PG_REAL_HOME>/bin/` para o prefixo
   (`usr/libexec/postgresql17/`). Symlink e não cópia de propósito: o
   postmaster resolve o binário real via `/proc/self/exe` e deriva
   share (`/usr/share/postgresql17`) e pkglibdir (`/usr/lib/postgresql17`)
   a partir dele — o layout `libexec/postgresql17` é relocatable e encontra
   tudo dentro do prefixo. Uma cópia em outro diretório cairia nos caminhos
   compilados `/usr/*`, inexistentes sem root, e o servidor não sobe
   (`FATAL ... incomplete PostgreSQL installation`). O `initdb` roda do
   prefixo pelo mesmo motivo (os input files — bki, timezonesets — saem do
   `get_share_path` do binário).
3. **`passwd`/`group`** (nss_wrapper): este host roda como uid 1000 **sem
   entrada em `/etc/passwd`** (`whoami` falha) — o wrapper dá identidade ao
   servidor via `LD_PRELOAD=libnss_wrapper.so`.
4. **`initdb`** em `<PG_REAL_HOME>/data`: superuser `postgres`, `--auth=trust`
   (só loopback), locale C (`--no-locale`), UTF-8.
5. **`postgresql.conf`**: `port`, `listen_addresses='127.0.0.1'`,
   `unix_socket_directories` no próprio data dir e `timezone/log_timezone =
   'UTC0'` (**numérico**: evita a dependência de `/usr/share/zoneinfo`, que
   não existe fora do prefixo).
6. **`pg_ctl start -w`** + `pg_isready` → servidor pronto em
   `127.0.0.1:<porta>`.

Requisitos: host **Alpine com `apk`** (para a instalação automática) ou um
prefixo pré-existente via `PG_ALPINE_PREFIX`. Sem rede não há problema se o
prefixo já existir.

## 2. Variáveis de ambiente

| Variável | Padrão | Papel |
| --- | --- | --- |
| `PG_REAL_HOME` | `<repo>/.pg-real` | raiz de `bin/`, `data/`, `passwd`, `group`, `server.log` — tudo que o script apaga fica aqui |
| `PG_ALPINE_PREFIX` | `<PG_REAL_HOME>/alpine` | prefixo Alpine com `postgresql17` (libs + `usr/libexec/postgresql17`) |
| `PG_REAL_PORT` | `5433` | porta em 127.0.0.1 |
| `PATH` | — | `<PG_REAL_HOME>/bin` na frente (psql, pg_ctl) |
| `LD_LIBRARY_PATH` | — | `<prefixo>/usr/lib:<prefixo>/usr/lib/postgresql17` (libs Alpine: icu, zstd, lz4, ldap, xml2...) |
| `LD_PRELOAD` | — | `<prefixo>/usr/lib/libnss_wrapper.so` (uid 1000 sem passwd) |
| `NSS_WRAPPER_PASSWD` / `NSS_WRAPPER_GROUP` | — | arquivos gerados pelo `setup` em `PG_REAL_HOME` |
| `ICU_DATA` | — | `<prefixo>/usr/share/icu/<ver>` (dat `icudt*.dat`) |
| `PGHOST` / `PGPORT` / `PGUSER` | `127.0.0.1` / `5433` / `postgres` | consumidos por `upgrade-pg-real.mjs` e pelos testes |
| `DATABASE_URL` | — | só para `prisma migrate` (o script de upgrade monta a própria URL) |
| `PG_PERMIT_HOST` | (vazio) | exceção explícita p/ host não-loopback no upgrade (ver §3) |

Em vez de montar à mão:

```bash
eval "$(node packages/database/scripts/pg-real.mjs env)"   # imprime os exports
```

## 3. Execução

```bash
# 0) servidor de validação
node packages/database/scripts/pg-real.mjs setup
eval "$(node packages/database/scripts/pg-real.mjs env)"    # mesma saída do setup
node packages/database/scripts/pg-real.mjs status           # exit 0 = rodando, 3 = parado

# 1) rebuild / upgrade de migrações em PG real (bancos dc_pgreal_* descartáveis,
#    droppados ao final de cada execução; só loopback — host remoto é bloqueado)
node packages/database/scripts/upgrade-pg-real.mjs rebuild   # banco vazio: 28 migrations + inserts ORM sem id
node packages/database/scripts/upgrade-pg-real.mjs prodlike  # base "de produção": dados preservados, 4 pendentes
node packages/database/scripts/upgrade-pg-real.mjs legacy    # base legada TEXT→uuid: 20 pendentes, dados intactos

# 2) teste de concorrência ERP (duas conexões Prisma independentes em PG real;
#    cria e droppa dc_concorrencia; exige o ambiente exportado — §2)
cd apps/web && npx vitest run src/lib/__tests__/concorrencia-erp.test.ts

# 3) suíte completa (o teste acima entra junto quando o ambiente está exportado)
cd apps/web && npx vitest run
```

Sem ambiente exportado, o teste de concorrência **falha com mensagem que
aponta para este doc** (não vira skip — nunca trocar falha por resultado
vazio).

### Proteções anti-destrutivo

- `upgrade-pg-real.mjs`: só aceita `<rebuild|prodlike|legacy>` (modo desconhecido
  → usage e exit 1) e **recusa `PGHOST` não-loopback** (o script faz
  `DROP/CREATE DATABASE` — `PG_PERMIT_HOST=1` é a única exceção, deliberada);
  além disso só opera em bancos `dc_pgreal_*` e os dropa no `finally`.
- `pg-real.mjs`: servidor só escuta em 127.0.0.1; `PG_REAL_HOME` e o prefixo
  precisam ser subdiretórios do HOME/repositório (recusa `/`, `$HOME`, raiz do
  repo, `/etc`, `/usr`, ...); `clean` **exige `--yes`** e só remove arquivos
  que ele próprio criou dentro da raiz — **nenhum SQL contra servidor externo**;
  `apk --usermode --root` nunca escreve fora do prefixo.

## 4. Limpeza

```bash
node packages/database/scripts/pg-real.mjs stop             # para o servidor (fast)
node packages/database/scripts/pg-real.mjs clean --yes      # apaga data/ bin/ passwd group log
node packages/database/scripts/pg-real.mjs clean --yes --tudo  # + prefixo alpine (rebaixa de novo)
```

Bancos de validação (`dc_pgreal_*`, `dc_concorrencia`, `dc_build_isolado`)
são droppados pelos próprios scripts/testes; se sobrarem por interrupção:
`psql -h 127.0.0.1 -U postgres -c 'DROP DATABASE IF EXISTS dc_pgreal_rebuild;'`
etc. Restos de upgrade antigos no repo (`.tmp-upgrade-a/-b/-legacy`) também
estão no `.gitignore` e são removidos no `finally` do upgrade.

## 5. Registro desta rodada (checkout limpo)

Executado a partir de um `git clone` novo, sem nenhum artefato de diretório
provisório (`tmp-exp`), com servidor criado do zero via `setup` (instalação
via apk inclusa), `upgrade-pg-real.mjs` nos 3 modos e `stop`/`clean` no fim:

- instalação apk: 4 pacotes (+deps) no prefixo do clone;
- `rebuild`: 28 migrações em banco vazio + inserts ORM sem id (`Refund`,
  `OrderTrackToken`, `ErpEvent`, `EmailOutbox`, `RateLimit`) todos `ok`;
- `prodlike`: 4 pendentes, `dadosPreservados:true` (2 users/2 orders/1 review/
  1 orderItem/1 cartItem), unicidades bloqueando 2ª linha;
- `legacy`: 20 pendentes com TEXT→uuid preservando os mesmos dados;
- teste de concorrência em PG real: 6 testes verdes;
- `clean --yes`: raiz do clone volta a ficar só com os arquivos versionados.
