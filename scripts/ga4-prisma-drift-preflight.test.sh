#!/usr/bin/env bash
set -euo pipefail

if [[ ${DATABASE_URL:-} != 'postgresql://postgres:postgres@localhost:5432/divine_ga4_test' ]]; then
  echo 'Synthetic preflight requires the dedicated disposable database.' >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Session-local tables model legacy data even when replayed FKs reject orphans.
# Both SQL files run in one session so the preflight resolves those tables first.
actual="$(psql -X -qAt -v ON_ERROR_STOP=1 "$DATABASE_URL" -f - \
  -f "$script_dir/ga4-prisma-drift-preflight.sql" <<'SQL'
CREATE TEMP TABLE "Category" (id integer PRIMARY KEY);
CREATE TEMP TABLE "lotes_compra" (id integer PRIMARY KEY, nome text, categoria_id integer);
CREATE TEMP TABLE "materiais_embalagem" (nome text);
CREATE TEMP TABLE "Product" (
  custo_peca_centavos integer,
  custo_embalagem_centavos integer,
  precificacao_calculada_em timestamptz,
  lote_id integer
);

INSERT INTO "Category" VALUES (1);
INSERT INTO "lotes_compra" VALUES (1, 'Lote A', 1), (2, 'Lote A', 99), (3, 'Lote B', NULL);
INSERT INTO "materiais_embalagem" VALUES ('Material A'), ('Material A'), ('Material B');
INSERT INTO "Product" VALUES
  (NULL, 100, NULL, 1),
  (100, NULL, NULL, 99),
  (0, 100, NULL, NULL);
SQL
)"

expected="$(cat <<'EOF'
product_null_cost_rows|2
lotes_duplicate_nome_groups|1
materiais_duplicate_nome_groups|1
lotes_orphan_categoria_rows|1
product_orphan_lote_rows|1
EOF
)"
observed="$(printf '%s\n' "$actual" | grep -E '^(product_null_cost_rows|lotes_duplicate_nome_groups|materiais_duplicate_nome_groups|lotes_orphan_categoria_rows|product_orphan_lote_rows)\|')"
diff -u <(printf '%s\n' "$expected") <(printf '%s\n' "$observed")
printf '%s\n' "$observed"
