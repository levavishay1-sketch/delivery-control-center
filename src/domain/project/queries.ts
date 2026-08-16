import { db } from "@/lib/db";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";

/** undefined means "no filter" (org admin); otherwise the list of clientIds ctx can see. */
function accessibleClientIds(ctx: AuthContext): string[] | undefined {
  return ctx.isOrgAdmin ? undefined : ctx.memberships.map((m) => m.clientId);
}

/**
 * Projects with their client, work items, and pipeline status, for the home page list — scoped to
 * ctx's accessible clients. Excludes projects under a deactivated client (Slice 12 — Dashboard is
 * an active-work surface; the Clients hub is where a deactivated client's projects stay visible).
 */
export async function listProjectsForHome(ctx: AuthContext) {
  const clientIds = accessibleClientIds(ctx);
  return db.project.findMany({
    where: { client: { active: true }, ...(clientIds ? { clientId: { in: clientIds } } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      client: true,
      workItems: {
        orderBy: { createdAt: "desc" },
        include: { pipeline: true },
      },
      // Slice 4 — the current sync type/status lives on Connector, not Project.
      connector: true,
    },
  });
}

/** Projects with a work-item count, for the projects API — scoped to ctx's accessible clients. */
export async function listProjectsWithCounts(ctx: AuthContext) {
  const clientIds = accessibleClientIds(ctx);
  return db.project.findMany({
    where: clientIds ? { clientId: { in: clientIds } } : undefined,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { workItems: true } } },
  });
}

/**
 * Unchecked lookup for internal domain use (e.g. resolving a project's clientId before an
 * authz check elsewhere). Do not call this directly from an API route or page — use
 * getProjectByIdForUser, which enforces access.
 */
export async function getProjectById(id: string) {
  return db.project.findUnique({ where: { id } });
}

/** Project lookup that enforces ctx has at least read access to its client. Returns null if not found. */
export async function getProjectByIdForUser(ctx: AuthContext, id: string) {
  const project = await getProjectById(id);
  if (!project) return null;
  requireClientRole(ctx, project.clientId, ALL_ROLES);
  return project;
}
