import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, dbKind, withTenant } from "@dcc/db";
import { users, workitem, project } from "@dcc/db/schema";
import type { FastifyRequest } from "fastify";

/**
 * Phase 0 request identity. NOT production auth — a pilot shim:
 *   - hooks send `x-dcc-hook-token` (shared secret) + `x-dcc-dev-email`
 *   - the dev email maps to a `users` row (the acting person — decision 02)
 * Real auth (Entra ID) is a later slice; the shape here (every request
 * carries a resolved user + a tenant) is what stays.
 */

export class AuthError extends Error {}
export class NotFound extends Error {}

export async function actingUser(req: FastifyRequest): Promise<{ id: string; email: string }> {
  const token = req.headers["x-dcc-hook-token"];
  if (!process.env.DCC_HOOK_TOKEN || token !== process.env.DCC_HOOK_TOKEN) {
    throw new AuthError("bad or missing x-dcc-hook-token");
  }
  const email = String(req.headers["x-dcc-dev-email"] ?? "").toLowerCase();
  if (!email) throw new AuthError("missing x-dcc-dev-email");

  const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (u) return u;

  // Dev convenience: auto-create the acting user on the embedded DB so
  // the local UI works out of the box. Never on a real Postgres.
  if (dbKind === "pglite") {
    const [created] = await db
      .insert(users)
      .values({ entraOid: `dev-${randomUUID()}`, email, displayName: email.split("@")[0] ?? email })
      .returning({ id: users.id, email: users.email });
    return created!;
  }
  throw new AuthError(`no user for ${email}`);
}

/** Resolve the tenant + WorkItem from an id or a key. */
export async function locateWorkItem(ref: { id?: string; key?: string }) {
  const cond = ref.id ? sql`${workitem.id} = ${ref.id}` : sql`${workitem.key} = ${ref.key}`;
  const [wi] = await db
    .select({ id: workitem.id, key: workitem.key, clientId: workitem.clientId, projectId: workitem.projectId, title: workitem.title })
    .from(workitem)
    .where(cond)
    .limit(1);
  if (!wi) throw new NotFound("workitem");
  return wi;
}

export async function locateProject(projectId: string) {
  const [p] = await db.select({ id: project.id, clientId: project.clientId }).from(project).where(sql`${project.id} = ${projectId}`).limit(1);
  if (!p) throw new NotFound("project");
  return p;
}

export { withTenant };
