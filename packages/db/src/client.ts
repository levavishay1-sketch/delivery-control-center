import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema/index.ts";

const { Pool } = pg;

/**
 * The one connection pool. The app connects as `dcc_app` — a role that
 * is NOT a superuser and does NOT have BYPASSRLS, so the RLS policies in
 * the schema are actually enforced (architecture decision 03).
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
export { schema };

/**
 * Run `fn` with the tenant wall in place. Every query inside sees only
 * rows for `clientId`; RLS `WITH CHECK` refuses writes for any other
 * client. This is the ONLY correct way to touch tenant-scoped tables.
 *
 * Implemented as a transaction-local `SET LOCAL`, so the setting can
 * never leak to another pooled checkout.
 */
export async function withTenant<T>(
  clientId: string,
  fn: (tx: NodeTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_client', ${clientId}, true)`);
    return fn(tx);
  });
}

/**
 * For org-admin / cross-tenant reads (directory listing, dashboards).
 * Runs with NO tenant set — every tenant policy yields false, so this
 * path is only useful on the non-RLS tables (users, repo, repo_dependency)
 * or via an admin role added later. Kept explicit so "no tenant" is
 * always a deliberate choice, never an accident.
 */
export async function withoutTenant<T>(fn: (tx: NodeTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

type NodeTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
