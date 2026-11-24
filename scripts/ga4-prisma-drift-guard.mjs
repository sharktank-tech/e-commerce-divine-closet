import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guarda de regressão, NÃO um resolvedor de drift.
 *
 * Recebe o stdout/stderr do Prisma migrate diff com --exit-code.
 * Code 2 é permitido SOMENTE quando cada entrada é idêntica ao baseline
 * registrado após migrate deploy num PostgreSQL descartável. Qualquer
 * nova diferença, alteração da lista ou erro de execução bloqueia o CI.
 */
export function extractDriftEntries(raw) {
  return raw
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\[(?:\*|\+|-)\]\s/.test(line));
}

export function verifyKnownDrift(raw, status, baseline) {
  if (!Number.isInteger(status) || (status !== 0 && status !== 2))
    throw new Error(`prisma_migrate_diff_failed: exit=${status}`);
  if (!baseline || !Array.isArray(baseline.entries) || !Number.isInteger(baseline.tables))
    throw new Error("invalid_legacy_drift_baseline");

  const found = extractDriftEntries(raw);
  if (status === 0 && baseline.entries.length) {
    throw new Error("legacy_drift_changed_or_resolved: baseline requires an explicit review");
  }
  if (status === 2 && !found.length)
    throw new Error("prisma_reports_drift_without_parseable_changes");
  const tables = found.filter((line) => /^\[\*\] Changed the .+ table$/.test(line)).length;
  if (tables !== baseline.tables || JSON.stringify(found) !== JSON.stringify(baseline.entries)) {
    const known = new Set(baseline.entries);
    const actual = new Set(found);
    const added = found.filter((entry) => !known.has(entry));
    const missing = baseline.entries.filter((entry) => !actual.has(entry));
    throw new Error(
      "unexpected_prisma_drift: review required " +
      JSON.stringify({ expectedTables: baseline.tables, actualTables: tables, added, missing, entries: found.length }),
    );
  }
  return { tables, entries: found.length, driftKnown: status === 2 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const filename = process.argv[2];
    const status = Number(process.argv[3]);
    if (!filename || !Number.isInteger(status))
      throw new Error("usage: node scripts/ga4-prisma-drift-guard.mjs <diff-log> <exit-status>");
    const baseline = JSON.parse(readFileSync(new URL("./ga4-prisma-legacy-drift.baseline.json", import.meta.url), "utf8"));
    const result = verifyKnownDrift(readFileSync(filename, "utf8"), status, baseline);
    console.log(`::warning::Known legacy drift matched baseline: ${result.tables} tables / ${result.entries} entries. NOT resolved; review before deployment.`);
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
