import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { rawExec, dbKind, closeDb } from "../client.ts";

/**
 * Applies every migration in `migrations/` then `sql/guards.sql`.
 * Idempotent-ish for PGlite dev: safe to re-run on a fresh `.pgdata`.
 * For a real Postgres, prefer `drizzle-kit migrate` + `npm run guards`.
 */
const migDir = fileURLToPath(new URL("../../migrations/", import.meta.url));
const guardsPath = fileURLToPath(new URL("../../sql/guards.sql", import.meta.url));

// Record what was applied, so `dev:migrate` can take over later and apply
// only what is newer. Without this record it would try to re-run every
// file, and an old file can no longer run once a later one dropped a
// column it references (found live, 2026-09-20).
await rawExec(`create table if not exists _dcc_migrations (name text primary key, applied_at timestamptz not null default now())`);
const files = (await readdir(migDir)).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  const sqlText = await readFile(new URL(`file://${migDir}${f}`), "utf8");
  // drizzle-kit separates statements with this marker; PGlite/pg both
  // accept the whole script, but splitting gives clearer errors.
  const statements = sqlText.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) await rawExec(stmt);
  await rawExec(`insert into _dcc_migrations(name) values ('${f}') on conflict (name) do nothing`);
  console.log(`applied ${f} (${statements.length} statements)`);
}

await rawExec(await readFile(guardsPath, "utf8"));
console.log("applied guards.sql — event_log append-only, dcc_app role ready");
console.log(`\ndatabase ready (${dbKind}).`);

await closeDb();
