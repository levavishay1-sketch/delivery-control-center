import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { rawExec, dbKind, closeDb, db } from "../client.ts";
import { sql } from "drizzle-orm";

/**
 * Incremental migrator — applies only the migration files not yet
 * recorded, so existing data survives. Re-runs guards.sql (idempotent)
 * every time. Use this instead of dev:setup once real data is in the DB.
 */
const migDir = fileURLToPath(new URL("../../migrations/", import.meta.url));
const guardsPath = fileURLToPath(new URL("../../sql/guards.sql", import.meta.url));

await rawExec(`create table if not exists _dcc_migrations (name text primary key, applied_at timestamptz not null default now())`);
const done = new Set(
  (await db.execute<{ name: string }>(sql`select name from _dcc_migrations`)).rows.map((r) => r.name),
);

const benign = /already exists|duplicate/i;
const files = (await readdir(migDir)).filter((f) => f.endsWith(".sql")).sort();
let applied = 0;
let adopted = 0;
for (const f of files) {
  if (done.has(f)) continue;
  const sqlText = await readFile(new URL(`file://${migDir}${f}`), "utf8");
  const statements = sqlText.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
  let skipped = 0;
  for (const stmt of statements) {
    try {
      await rawExec(stmt);
    } catch (e) {
      if (benign.test(String((e as Error).message))) skipped++;
      else throw e;
    }
  }
  await rawExec(`insert into _dcc_migrations(name) values ('${f}')`);
  if (skipped === statements.length) {
    adopted++;
  } else {
    console.log(`applied ${f} (${statements.length - skipped} statements)`);
    applied++;
  }
}
if (adopted) console.log(`adopted ${adopted} pre-existing migration(s) into the tracking table`);

await rawExec(await readFile(guardsPath, "utf8"));
console.log(applied === 0 ? "schema already current" : `${applied} migration(s) applied`);
console.log(`guards.sql applied · database ready (${dbKind})`);
await closeDb();
