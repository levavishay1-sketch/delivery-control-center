import { db } from "@/lib/db";
import { getProjectById } from "@/domain/project/queries";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";

/**
 * Gets all active (unresolved) blockers for a work item.
 */
export async function getActiveBlockers(workItemId: string) {
  return db.blocker.findMany({
    where: {
      blockingItemId: workItemId,
      resolvedAt: null,
    },
    include: { owner: true },
    orderBy: { blockedSince: "desc" },
  });
}

/**
 * Gets all active blockers across accessible projects for a client.
 * Authorization: VIEWER_AND_ABOVE.
 */
export async function getAllActiveBlockers(ctx: AuthContext, clientId: string) {
  requireClientRole(ctx, clientId, ALL_ROLES);

  // Get all projects in this client that the user has access to
  const projects = await db.project.findMany({
    where: { clientId },
    select: { id: true },
  });

  const projectIds = projects.map((p) => p.id);

  return db.blocker.findMany({
    where: {
      blockingItem: {
        projectId: { in: projectIds },
      },
      resolvedAt: null,
    },
    include: { blockingItem: true, owner: true },
    orderBy: { blockedSince: "desc" },
  });
}

/**
 * Gets a single blocker by ID (with authorization check).
 */
export async function getBlocker(ctx: AuthContext, blockerId: string) {
  const blocker = await db.blocker.findUnique({
    where: { id: blockerId },
    include: { blockingItem: true, owner: true },
  });

  if (!blocker) return null;

  const project = await getProjectById(blocker.blockingItem.projectId);
  if (!project) return null;

  requireClientRole(ctx, project.clientId, ALL_ROLES);

  return blocker;
}
