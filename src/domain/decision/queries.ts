import { db } from "@/lib/db";
import { getProjectById } from "@/domain/project/queries";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";

/**
 * Gets all pending (open) decisions for a work item.
 */
export async function getWorkItemDecisions(workItemId: string) {
  return db.decision.findMany({
    where: {
      workItemId,
      status: "OPEN",
    },
    include: { approver: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Gets all pending decisions across accessible projects for a client.
 * Authorization: ALL_ROLES.
 */
export async function getPendingDecisions(ctx: AuthContext, clientId: string) {
  requireClientRole(ctx, clientId, ALL_ROLES);

  // Get all projects in this client
  const projects = await db.project.findMany({
    where: { clientId },
    select: { id: true },
  });

  const projectIds = projects.map((p) => p.id);

  return db.decision.findMany({
    where: {
      workItem: {
        projectId: { in: projectIds },
      },
      status: "OPEN",
    },
    include: { workItem: true, approver: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Gets a single decision by ID (with authorization check).
 */
export async function getDecision(ctx: AuthContext, decisionId: string) {
  const decision = await db.decision.findUnique({
    where: { id: decisionId },
    include: { workItem: true, approver: true },
  });

  if (!decision) return null;

  const project = await getProjectById(decision.workItem.projectId);
  if (!project) return null;

  requireClientRole(ctx, project.clientId, ALL_ROLES);

  return decision;
}
