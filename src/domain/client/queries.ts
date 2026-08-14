import { db } from "@/lib/db";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";

/** Clients ctx can see: all of them for an org admin, otherwise only clients ctx has a membership on. */
export async function listClients(ctx: AuthContext) {
  const clientIds = ctx.isOrgAdmin ? undefined : ctx.memberships.map((m) => m.clientId);
  return db.client.findMany({
    where: clientIds ? { id: { in: clientIds } } : undefined,
    orderBy: { createdAt: "desc" },
    include: { organization: true },
  });
}

export async function getClientById(ctx: AuthContext, id: string) {
  const client = await db.client.findUnique({ where: { id } });
  if (!client) return null;
  requireClientRole(ctx, client.id, ALL_ROLES);
  return client;
}
