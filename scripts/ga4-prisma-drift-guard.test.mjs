import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractDriftEntries, verifyKnownDrift } from "./ga4-prisma-drift-guard.mjs";

const baseline = JSON.parse(readFileSync(new URL("./ga4-prisma-legacy-drift.baseline.json", import.meta.url), "utf8"));
const example = [
  "warn: Prisma configuration deprecated",
  "",
  ...baseline.entries,
  "",
].join("\n");

test("baseline contains 5 remaining legacy tables and 18 change entries", () => {
  assert.equal(baseline.tables, 5);
  assert.equal(baseline.entries.length, 18);
  assert.equal(extractDriftEntries(example).length, 18);
  assert.deepEqual(verifyKnownDrift(example, 2, baseline), { tables: 5, entries: 18, driftKnown: true });
});

test("Prisma v6 ANSI coloring does not alter the comparison", () => {
  const colored = example.replace("[*] Changed", "\x1b[33m[*] Changed");
  assert.deepEqual(verifyKnownDrift(colored, 2, baseline), { tables: 5, entries: 18, driftKnown: true });
});

test("new or reordered drift is blocked rather than silently allowed", () => {
  assert.throws(() => verifyKnownDrift(example + "\n[+] Added the `NewTable` table\n", 2, baseline), /unexpected_prisma_drift/);
  assert.throws(() => verifyKnownDrift(example.replace(baseline.entries[0] + "\n", ""), 2, baseline), /unexpected_prisma_drift/);
  assert.throws(() => verifyKnownDrift(example.replace(baseline.entries[3], "[*] Changed the `Another` table"), 2, baseline), /unexpected_prisma_drift/);
});

test("CLI errors fail closed; code 2 without parsed diff also fails", () => {
  assert.throws(() => verifyKnownDrift("Error: database unavailable", 1, baseline), /prisma_migrate_diff_failed/);
  assert.throws(() => verifyKnownDrift("Error: no migration history", 2, baseline), /prisma_reports_drift_without_parseable_changes/);
  assert.throws(() => verifyKnownDrift(example, NaN, baseline), /prisma_migrate_diff_failed/);
});

test("disappearance of known drift requires deliberate baseline review", () => {
  assert.throws(() => verifyKnownDrift("", 0, baseline), /legacy_drift_changed_or_resolved/);
});

test("a new empty baseline may pass only a genuinely clean Prisma diff", () => {
  const clean = { tables: 0, entries: [] };
  assert.deepEqual(verifyKnownDrift("No difference detected.", 0, clean), { tables: 0, entries: 0, driftKnown: false });
});
