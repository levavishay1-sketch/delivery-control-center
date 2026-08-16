import { db } from "@/lib/db";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";

/** Clients ctx can see: all of them for an org admin, otherwise only clients ctx has a membership on. */
export async function listClients(ctx: AuthContext) {
  const clientIds = ctx.isOrgAdmin ? undefined : ctx.memberships.map((m) => m.clientId);
  return db.client.findMany({
    where: clientIds ? { id: { in: clientIds } } : undefined,
    orderBy: { createdAt: "desc" },
    include: { organization: true, _count: { select: { projects: true } } },
  });
}

export async function getClientById(ctx: AuthContext, id: string) {
  const client = await db.client.findUnique({ where: { id } });
  if (!client) return null;
  requireClientRole(ctx, client.id, ALL_ROLES);
  return client;
}

/** Slice 12 — same access-scoping as listClients, narrowed to clients excluded from active-work surfaces (Dashboard/Attention Center). */
export async function listActiveClients(ctx: AuthContext) {
  const clientIds = ctx.isOrgAdmin ? undefined : ctx.memberships.map((m) => m.clientId);
  return db.client.findMany({
    where: { active: true, ...(clientIds ? { id: { in: clientIds } } : {}) },
    orderBy: { createdAt: "desc" },
    include: { organization: true },
  });
}

/**
 * Slice 12/13 — a client's projects, its repository pool (via the client-owned
 * Repository.clientId, across all its projects), and its connectors (via the client-owned
 * Connector.clientId, Slice 13 — queried directly rather than derived from each project's own
 * connector), for the Clients hub detail page.
 */
export async function getClientDetail(ctx: AuthContext, id: string) {
  const client = await db.client.findUnique({ where: { id } });
  if (!client) return null;
  requireClientRole(ctx, client.id, ALL_ROLES);

  const [projects, repositories, connectors] = await Promise.all([
    db.project.findMany({
      where: { clientId: id },
      include: { connector: true },
      orderBy: { createdAt: "desc" },
    }),
    db.repository.findMany({
      where: { clientId: id },
      include: { projectLinks: { include: { project: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.connector.findMany({
      where: { clientId: id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return { client, projects, repositories, connectors };
}

/** Users with a membership on this client — for owner/executor pickers. Requires at least read access. */
export async function listClientMembers(ctx: AuthContext, clientId: string) {
  requireClientRole(ctx, clientId, ALL_ROLES);
  const memberships = await db.clientMembership.findMany({
    where: { clientId },
    include: { user: true },
    orderBy: { user: { name: "asc" } },
  });
  return memberships.map((m) => m.user);
}
