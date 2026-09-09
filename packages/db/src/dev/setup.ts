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

const files = (await readdir(migDir)).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  const sqlText = await readFile(new URL(`file://${migDir}${f}`), "utf8");
  // drizzle-kit separates statements with this marker; PGlite/pg both
  // accept the whole script, but splitting gives clearer errors.
  const statements = sqlText.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) await rawExec(stmt);
  console.log(`applied ${f} (${statements.length} statements)`);
}

await rawExec(await readFile(guardsPath, "utf8"));
console.log("applied guards.sql — event_log append-only, dcc_app role ready");
console.log(`\ndatabase ready (${dbKind}).`);

await closeDb();
