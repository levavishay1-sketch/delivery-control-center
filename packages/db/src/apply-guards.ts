import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Applies sql/guards.sql — the append-only triggers and the RLS-bound
 * application role. Run after `drizzle-kit migrate`. Idempotent.
 */
const sqlPath = fileURLToPath(new URL("../sql/guards.sql", import.meta.url));

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const ddl = await readFile(sqlPath, "utf8");
  await client.query(ddl);
  console.log("guards.sql applied: event_log is append-only, dcc_app role ready.");
} finally {
  await client.end();
}
