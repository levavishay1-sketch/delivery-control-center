import { sql } from "drizzle-orm";
import * as schema from "./schema/index.ts";

export { schema };

/**
 * One database handle for the whole app.
 *
 * Driver is chosen from `DATABASE_URL`:
 *   - unset / "pglite" / "file:..."  → embedded Postgres (PGlite), persisted
 *     to `packages/db/.pgdata`. No server, no install — the local dev and
 *     test path.
 *   - a real postgres:// URL          → node-postgres pool. The pilot /
 *     production path (Neon, or a managed Postgres).
 *
 * Both are Postgres 17/18 with identical RLS, trigger and DDL semantics,
 * so the schema and every query are portable between them.
 */

const url = process.env.DATABASE_URL;
const usePglite = !url || url === "pglite" || url.startsWith("pglite:") || url.startsWith("file:");

/**
 * Both drivers expose the same drizzle query surface; we present one
 * concrete type so callers are not forced to narrow a union on every
 * query. node-postgres is the canonical shape (the pilot/prod driver);
 * the PGlite handle is structurally compatible for everything we use.
 */
export type Db = import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema>;

type Handle = {
  kind: "pglite" | "pg";
  db: Db;
  /** Run a multi-statement SQL script (migrations, guards.sql) as-is. */
  exec: (sqlText: string) => Promise<void>;
  close: () => Promise<void>;
};

async function makeHandle(): Promise<Handle> {
  if (usePglite) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dir =
      process.env.DCC_PGLITE_DIR ??
      new URL("../.pgdata/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const client = await PGlite.create(dir);
    return {
      kind: "pglite",
      db: drizzle(client, { schema }) as unknown as Db,
      exec: async (s) => void (await client.exec(s)),
      close: () => client.close(),
    };
  }
  const pg = (await import("pg")).default;
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new pg.Pool({ connectionString: url });
  return {
    kind: "pg",
    db: drizzle(pool, { schema }),
    exec: async (s) => void (await pool.query(s)),
    close: () => pool.end(),
  };
}

const handle = await makeHandle();

export const db = handle.db;
export const dbKind = handle.kind;
export const rawExec = handle.exec;
export const closeDb = handle.close;

/**
 * Run `fn` with the tenant wall in place. Inside the transaction:
 *   1. drop to the `dcc_app` role (NOSUPERUSER NOBYPASSRLS) so RLS is
 *      actually enforced — a superuser silently bypasses it;
 *   2. set `app.current_client` so every policy resolves to this tenant.
 * Both are `SET LOCAL`, scoped to the transaction, pool-safe.
 *
 * This is the only correct way to touch a tenant-scoped table.
 */
export async function withTenant<T>(clientId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role dcc_app`);
    await tx.execute(sql`select set_config('app.current_client', ${clientId}, true)`);
    return fn(tx);
  });
}

/**
 * Cross-tenant path for org-admin reads (directory, dashboards). Runs as
 * the connecting role with no tenant set — every tenant policy yields
 * false, so this only reaches the non-RLS tables (`users`, `repo`,
 * `repo_dependency`) or an admin role added later. Explicit so "no
 * tenant" is always a deliberate choice.
 */
export async function withoutTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(tx));
}

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
