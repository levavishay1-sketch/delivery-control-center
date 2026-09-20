import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { rawExec, closeDb } from "../client.ts";

/**
 * Marks migrations as already applied WITHOUT running them.
 *
 * For a database that `dev:setup` created before it recorded what it
 * applied: every file up to and including the one named is written into
 * `_dcc_migrations`, so `dev:migrate` takes over from there and applies only
 * what is newer. Re-running an old file against such a database is not an
 * option — a later migration may have dropped a column it references.
 *
 *   node src/dev/adopt-migrations.ts 0034_onboarding_native_init.sql
 *
 * Run with the API STOPPED (PGlite is single-process).
 */
const through = process.argv[2];
if (!through) {
  console.error("usage: adopt-migrations.ts <last-migration-file-already-in-the-database>");
  process.exit(2);
}
const migDir = fileURLToPath(new URL("../../migrations/", import.meta.url));
const files = (await readdir(migDir)).filter((f) => f.endsWith(".sql")).sort();
if (!files.includes(through)) {
  console.error(`no migration named ${through}`);
  process.exit(2);
}
await rawExec(`create table if not exists _dcc_migrations (name text primary key, applied_at timestamptz not null default now())`);
let adopted = 0;
for (const f of files) {
  await rawExec(`insert into _dcc_migrations(name) values ('${f}') on conflict (name) do nothing`);
  adopted++;
  if (f === through) break;
}
console.log(`adopted ${adopted} migration(s) through ${through} — dev:migrate applies only what is newer`);
await closeDb();
