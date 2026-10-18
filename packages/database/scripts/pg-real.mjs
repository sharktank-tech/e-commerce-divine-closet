#!/usr/bin/env node
// PostgreSQL REAL local DESCARTÁVEL (127.0.0.1) para as validações de
// rebuild/upgrade (upgrade-pg-real.mjs) e do teste de concorrência ERP.
// Instala o PostgreSQL 17 Alpine num prefixo próprio (apk --usermode, sem
// root), cria o cluster, sobe/para o servidor e limpa — tudo dentro de
// PG_REAL_HOME. Documentação completa: packages/database/PG-REAL.md
//
// Uso:
//   node packages/database/scripts/pg-real.mjs setup       # instala + inicia
//   node packages/database/scripts/pg-real.mjs status      # rodando? (0/3)
//   node packages/database/scripts/pg-real.mjs stop        # para (fast)
//   node packages/database/scripts/pg-real.mjs clean --yes # apaga data+bin
//   node packages/database/scripts/pg-real.mjs clean --yes --tudo # + prefixo
//   node packages/database/scripts/pg-real.mjs env         # imprime exports
//
// Variáveis (opcionais):
//   PG_REAL_HOME     onde ficam bin/ e data/   (padrão <repo>/.pg-real)
//   PG_ALPINE_PREFIX prefixo alpine com postgresql17
//                    (padrão <PG_REAL_HOME>/alpine; reaproveita se já existe)
//   PG_REAL_PORT     porta em 127.0.0.1        (padrão 5433)
//
// PROTEÇÕES anti-destrutivo:
//   - servidor só escuta em 127.0.0.1;
//   - PG_REAL_HOME e o prefixo precisam ser subdiretórios do HOME ou do
//     repositório (recusa /, $HOME, raiz do repo, /etc, /usr, ...);
//   - `clean` exige --yes e só remove arquivos que este script criou dentro
//     da raiz (nunca dropa banco alheio — não há SQL contra servidor externo);
//   - instalação usa apk --usermode --root (sem root, sem tocar no sistema);
//     requer host Alpine com `apk` (caso contrário, aponte PG_ALPINE_PREFIX
//     para um prefixo já existente — setup pula a instalação).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..", "..");
const HOME = resolve(homedir());

const [sub = "status", ...flags] = process.argv.slice(2);
const SIM = flags.includes("--yes") || flags.includes("-y");
const TUDO = flags.includes("--tudo");

const RAIZ = resolve(process.env.PG_REAL_HOME || join(REPO, ".pg-real"));
const PREFIXO = resolve(process.env.PG_ALPINE_PREFIX || join(RAIZ, "alpine"));
const PORTA = Number(process.env.PG_REAL_PORT || 5433);
const BIN = join(RAIZ, "bin");
const DADOS = join(RAIZ, "data");
const LOG = join(RAIZ, "server.log");
const PASSWD = join(RAIZ, "passwd");
const GROUP = join(RAIZ, "group");
const PACOTES = ["postgresql17", "postgresql17-client", "tzdata", "nss_wrapper"];
const SUBS = ["setup", "status", "stop", "clean", "env"];

const bloquear = (msg) => {
  console.error(`✗ BLOQUEADO: ${msg}`);
  process.exit(1);
};

if (!SUBS.includes(sub)) {
  console.error(`Uso: node packages/database/scripts/pg-real.mjs <${SUBS.join("|")}> [--yes] [--tudo]`);
  process.exit(1);
}
if (!Number.isInteger(PORTA) || PORTA < 1024 || PORTA > 65535) {
  bloquear(`PG_REAL_PORT=${process.env.PG_REAL_PORT} inválida (1024..65535)`);
}
// validação da raiz ANTES de qualquer subcomando (inclusive clean/status):
// raiz ampla demais nunca é percorrida nem removida.
raizSegura(RAIZ, "PG_REAL_HOME");

// raiz ampla demais = risco de apagar algo que não é nosso
function raizSegura(caminho, rotulo) {
  const r = resolve(caminho);
  const proibidos = [
    "/", HOME, REPO, "/home", "/etc", "/usr", "/var", "/tmp", "/bin",
    "/sbin", "/lib", "/opt", "/srv", "/root", "/usr/local",
  ];
  if (proibidos.includes(r)) {
    bloquear(`${rotulo}="${r}" é amplo demais; use um subdiretório dedicado`);
  }
  if (r.split("/").filter(Boolean).length < 2) {
    bloquear(`${rotulo}="${r}" não é um subdiretório`);
  }
  if (!(r.startsWith(HOME + "/") || r.startsWith(REPO + "/"))) {
    bloquear(`${rotulo}="${r}" fora de HOME/repositório`);
  }
  return r;
}

const libPrefixo = () => [join(PREFIXO, "usr/lib"), join(PREFIXO, "usr/lib/postgresql17")];

function icuData() {
  const base = join(PREFIXO, "usr/share/icu");
  if (!existsSync(base)) return null;
  const filhos = readdirSync(base).filter((d) =>
    existsSync(join(base, d)) && readdirSync(join(base, d)).some((f) => f.startsWith("icudt"))
  );
  if (filhos.length === 1) return join(base, filhos[0]);
  return readdirSync(base).some((f) => f.startsWith("icudt")) ? base : null;
}

function envAlpine() {
  const env = { ...process.env, LD_LIBRARY_PATH: libPrefixo().join(":") };
  const nss = join(PREFIXO, "usr/lib/libnss_wrapper.so");
  if (existsSync(nss)) {
    env.LD_PRELOAD = nss;
    env.NSS_WRAPPER_PASSWD = PASSWD;
    env.NSS_WRAPPER_GROUP = GROUP;
  }
  const icu = icuData();
  if (icu) env.ICU_DATA = icu;
  return env;
}

function gravarNss() {
  mkdirSync(RAIZ, { recursive: true });
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  const gid = typeof process.getgid === "function" ? process.getgid() : 1000;
  const nome = process.env.LOGNAME || process.env.USER || "opencode";
  writeFileSync(PASSWD, `${nome}:x:${uid}:${gid}:${nome}:${HOME}:/bin/sh\n`);
  writeFileSync(GROUP, `${nome}:x:${gid}:\n`);
}

function ligarBinarios() {
  mkdirSync(BIN, { recursive: true });
  const origens = [join(PREFIXO, "usr/libexec/postgresql17"), join(PREFIXO, "usr/bin")];
  for (const nome of ["initdb", "pg_ctl", "pg_isready", "postgres", "psql"]) {
    const de = origens.map((d) => join(d, nome)).find((p) => existsSync(p));
    if (!de) {
      if (nome === "psql") {
        console.error("· aviso: psql não encontrado (instale postgresql17-client)");
        continue;
      }
      bloquear(`binário "${nome}" ausente em ${origens.join(" / ")} — rode "setup" (instala o prefixo)`);
    }
    // SYMLINK, não cópia: o postmaster resolve o binário REAL via
    // /proc/self/exe e deriva share (/usr/share/postgresql17) e pkglibdir
    // (/usr/lib/postgresql17) a partir dele — o layout <prefixo>/usr/libexec/
    //postgresql17 é relocatable e acha tudo DENTRO do prefixo. Uma cópia em
    // outro diretório cairia nos caminhos compilados /usr/*, inexistentes
    // sem root (instalação usermode) → FATAL "incomplete PostgreSQL
    // installation" na subida do servidor.
    const para = join(BIN, nome);
    rmSync(para, { force: true });
    symlinkSync(de, para);
  }
}

async function instalarPrefixo() {
  const pronto = existsSync(join(PREFIXO, "usr/libexec/postgresql17", "initdb"));
  if (pronto) {
    console.log(`· prefixo alpine reaproveitado: ${PREFIXO}`);
    return;
  }
  raizSegura(PREFIXO, "PG_ALPINE_PREFIX");
  console.log(`· instalando ${PACOTES.join(" ")} em ${PREFIXO} (apk --usermode, sem root) ...`);
  // apk --root lê repositórios/keys do PRÓPRIO root: sem semear, dá
  // "no such package". Copia do sistema (host Alpine) — se não houver, falha
  // claro e instrui a apontar PG_ALPINE_PREFIX para um prefixo existente.
  const reposSistema = "/etc/apk/repositories";
  const keysSistema = "/etc/apk/keys";
  if (!existsSync(reposSistema) || !existsSync(keysSistema)) {
    bloquear("sem /etc/apk/{repositories,keys}: host não-Alpine — defina PG_ALPINE_PREFIX para um prefixo já instalado");
  }
  mkdirSync(join(PREFIXO, "etc", "apk"), { recursive: true });
  cpSync(reposSistema, join(PREFIXO, "etc", "apk", "repositories"));
  cpSync(keysSistema, join(PREFIXO, "etc", "apk", "keys"), { recursive: true });
  try {
    const { stdout, stderr } = await run(
      "apk",
      ["add", "--usermode", "--root", PREFIXO, "--initdb", "--no-cache", "--scripts=no", ...PACOTES],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    );
    if (stdout.trim()) console.log(stdout.trim().split("\n").slice(-2).join("\n"));
    if (stderr.trim()) console.error(stderr.trim().split("\n").slice(-3).join("\n"));
  } catch (e) {
    bloquear(`apk add falhou: ${(e.stderr || e.message || "").trim().split("\n").slice(-5).join(" | ")}`);
  }
}

async function inicializar() {
  if (existsSync(join(DADOS, "PG_VERSION"))) return;
  raizSegura(RAIZ, "PG_REAL_HOME");
  gravarNss();
  if (!existsSync(join(PREFIXO, "usr/lib/libnss_wrapper.so"))) {
    console.error("· aviso: libnss_wrapper.so ausente — initdb pode falhar se o uid não existir em /etc/passwd");
  }
  // initdb recusa diretório não-vazio: um initdb interrompido deixa resto
  // sem PG_VERSION — descarta e recomeça.
  if (existsSync(DADOS) && readdirSync(DADOS).length > 0) {
    raizSegura(DADOS, "data incompleta");
    console.log("· removendo data/ de initdb anterior incompleto");
    rmSync(DADOS, { recursive: true, force: true });
  }
  console.log(`· initdb -> ${DADOS} (superuser postgres, auth trust, locale C)`);
  // initdb precisa rodar do PRÓPRIO prefixo (usr/libexec/postgresql17): o
  // get_share_path() é derivado da localização do binário — de lá ele acha
  // <prefixo>/usr/share/postgresql17 (bki, information_schema, timezonesets).
  // Uma cópia em outro diretório resolveria o caminho compilado
  // /usr/share/postgresql17, que não existe sem root (instalação usermode).
  const SHARE = join(PREFIXO, "usr/share/postgresql17");
  if (!existsSync(join(SHARE, "postgres.bki"))) {
    bloquear(`prefixo sem share (usr/share/postgresql17/postgres.bki): ${PREFIXO} — instalação incompleta, rode "setup"`);
  }
  const initdbDe = [join(PREFIXO, "usr/libexec/postgresql17", "initdb"), join(BIN, "initdb")].find((p) => existsSync(p));
  if (!initdbDe) bloquear("initdb não encontrado (nem no prefixo nem em bin/) — rode \"setup\"");
  try {
    await run(initdbDe, ["-D", DADOS, "--no-locale", "--encoding=UTF8", "--auth=trust", "--username=postgres"], { env: envAlpine() });
  } catch (e) {
    bloquear(`initdb falhou: ${(e.stderr || e.message || "").trim().split("\n").slice(-4).join(" | ")}`);
  }
  // timezone numérico (UTC0) evita a dependência de /usr/share/zoneinfo,
  // que num prefixo alpine usermode não fica no caminho compilado do PG.
  appendFileSync(
    join(DADOS, "postgresql.conf"),
    [
      `port = ${PORTA}`,
      "listen_addresses = '127.0.0.1'",
      `unix_socket_directories = '${DADOS}'`,
      "timezone = 'UTC0'",
      "log_timezone = 'UTC0'",
      "",
    ].join("\n")
  );
}

async function iniciar() {
  gravarNss();
  console.log(`· pg_ctl start em 127.0.0.1:${PORTA} ...`);
  try {
    await run(join(BIN, "pg_ctl"), ["start", "-D", DADOS, "-l", LOG, "-w", "-t", "60"], { env: envAlpine() });
  } catch (e) {
    console.error((e.stderr || e.message || "").trim());
    bloquear(`servidor não subiu (veja ${LOG})`);
  }
}

async function parar(silencioso = false) {
  if (!existsSync(join(DADOS, "PG_VERSION"))) {
    if (!silencioso) console.log("· nada a parar (sem cluster)");
    return;
  }
  try {
    await run(join(BIN, "pg_ctl"), ["stop", "-D", DADOS, "-m", "fast", "-w", "-t", "60"], { env: envAlpine() });
    console.log("· servidor parado");
  } catch {
    if (!silencioso) console.log("· servidor já estava parado");
  }
}

async function status() {
  if (!existsSync(join(BIN, "pg_ctl")) || !existsSync(join(DADOS, "PG_VERSION"))) {
    console.log("parado (não instalado — rode setup)");
    return 3;
  }
  try {
    await run(join(BIN, "pg_ctl"), ["status", "-D", DADOS], { env: envAlpine() });
    console.log(`rodando (127.0.0.1:${PORTA}, data ${DADOS})`);
    return 0;
  } catch {
    console.log("parado");
    return 3;
  }
}

async function limpar() {
  if (!SIM) bloquear("clean remove data/ e bin/: confirme com --yes");
  await parar(true);
  for (const alvo of [DADOS, BIN, PASSWD, GROUP, LOG]) {
    raizSegura(alvo, "item");
    rmSync(alvo, { recursive: true, force: true });
  }
  if (TUDO) {
    raizSegura(PREFIXO, "PG_ALPINE_PREFIX");
    rmSync(PREFIXO, { recursive: true, force: true });
    console.log("· limpo (inclui prefixo alpine)");
  } else {
    console.log("· limpo (prefixo alpine mantido — use --tudo para apagar também)");
  }
}

function imprimirEnv() {
  const linhas = [
    `export PATH="${BIN}:$PATH"`,
    `export LD_LIBRARY_PATH="${libPrefixo().join(":")}"`,
  ];
  const nss = join(PREFIXO, "usr/lib/libnss_wrapper.so");
  if (existsSync(nss)) {
    linhas.push(`export LD_PRELOAD="${nss}"`);
    linhas.push(`export NSS_WRAPPER_PASSWD="${PASSWD}"`);
    linhas.push(`export NSS_WRAPPER_GROUP="${GROUP}"`);
  }
  const icu = icuData();
  if (icu) linhas.push(`export ICU_DATA="${icu}"`);
  linhas.push(`export PGHOST=127.0.0.1 PGPORT=${PORTA} PGUSER=postgres`);
  linhas.push(`export DATABASE_URL="postgresql://postgres@127.0.0.1:${PORTA}/postgres"`);
  console.log(linhas.join("\n"));
}

// ---------- execução ----------
switch (sub) {
  case "setup": {
    raizSegura(RAIZ, "PG_REAL_HOME");
    await instalarPrefixo();
    ligarBinarios();
    await inicializar();
    await iniciar();
    const codigo = await status();
    console.log("\n# exporte o ambiente (ou use `pg-real.mjs env`):");
    imprimirEnv();
    process.exit(codigo);
    break;
  }
  case "status":
    process.exit(await status());
    break;
  case "stop":
    await parar();
    break;
  case "clean":
    await limpar();
    break;
  case "env":
    raizSegura(RAIZ, "PG_REAL_HOME");
    imprimirEnv();
    break;
}
