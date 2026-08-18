import { z } from "zod";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { getWorkItemById } from "@/domain/work-item/queries";
import { getProjectById } from "@/domain/project/queries";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";

const addDependencySchema = z.object({
  workItemId: z.string().min(1),
  dependsOnWorkItemId: z.string().min(1),
  reason: z.string().min(1).max(2000),
});

export type AddDependencyInput = z.infer<typeof addDependencySchema>;

/**
 * Detects if adding a dependency would create a cycle.
 * Returns true if adding workItemId -> dependsOnWorkItemId would create a cycle.
 * This checks if there's already a path from dependsOnWorkItemId to workItemId;
 * if so, adding workItemId -> dependsOnWorkItemId would close a cycle.
 */
export async function detectCycles(workItemId: string, dependsOnWorkItemId: string): Promise<boolean> {
  // If they're the same, it's a self-cycle
  if (workItemId === dependsOnWorkItemId) return true;

  // BFS to find if there's a path from dependsOnWorkItemId to workItemId
  const queue: string[] = [dependsOnWorkItemId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if (current === workItemId) {
      // Found a path from dependsOnWorkItemId to workItemId
      return true;
    }

    // Find all items that current depends on (items reachable from current)
    const dependencies = await db.dependency.findMany({
      where: { workItemId: current },
      select: { dependsOnWorkItemId: true },
    });

    for (const dep of dependencies) {
      if (!visited.has(dep.dependsOnWorkItemId)) {
        queue.push(dep.dependsOnWorkItemId);
      }
    }
  }

  return false;
}

/**
 * Adds a dependency between two work items. Both must exist in the same project;
 * rejects cycles. Authorization: WRITE_ROLES (Manager+).
 */
export async function addDependency(ctx: AuthContext, rawInput: AddDependencyInput) {
  const input = addDependencySchema.parse(rawInput);

  if (input.workItemId === input.dependsOnWorkItemId) {
    throw new ValidationError("A work item cannot depend on itself.");
  }

  const dependent = await getWorkItemById(input.workItemId);
  if (!dependent) throw new NotFoundError("Work item not found");
  const target = await getWorkItemById(input.dependsOnWorkItemId);
  if (!target) throw new NotFoundError("Target work item not found");

  if (dependent.projectId !== target.projectId) {
    throw new ValidationError("Dependencies can only link items within the same project.");
  }

  const project = await getProjectById(dependent.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  // Check for duplicate
  const existing = await db.dependency.findUnique({
    where: { workItemId_dependsOnWorkItemId: { workItemId: input.workItemId, dependsOnWorkItemId: input.dependsOnWorkItemId } },
  });
  if (existing) throw new ValidationError("This dependency already exists.");

  // Cycle detection
  const wouldCycle = await detectCycles(input.workItemId, input.dependsOnWorkItemId);
  if (wouldCycle) throw new ValidationError("Adding this dependency would create a cycle.");

  const dependency = await db.$transaction(async (tx) => {
    const created = await tx.dependency.create({
      data: {
        workItemId: input.workItemId,
        dependsOnWorkItemId: input.dependsOnWorkItemId,
        reason: input.reason,
      },
      include: { workItem: true, dependsOnWorkItem: true },
    });

    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId: input.workItemId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} added dependency: "${created.workItem.title}" depends on "${created.dependsOnWorkItem.title}"`,
      detail: { reason: input.reason } as Record<string, unknown>,
    });

    return created;
  });

  return dependency;
}

/**
 * Removes a dependency. Authorization: WRITE_ROLES.
 */
export async function removeDependency(ctx: AuthContext, dependencyId: string) {
  const existing = await db.dependency.findUnique({
    where: { id: dependencyId },
    include: { workItem: true, dependsOnWorkItem: true },
  });
  if (!existing) throw new NotFoundError("Dependency not found");

  const project = await getProjectById(existing.workItem.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  const dependency = await db.$transaction(async (tx) => {
    const deleted = await tx.dependency.delete({
      where: { id: dependencyId },
      include: { workItem: true, dependsOnWorkItem: true },
    });

    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId: existing.workItem.id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} removed dependency: "${deleted.workItem.title}" no longer depends on "${deleted.dependsOnWorkItem.title}"`,
    });

    return deleted;
  });

  return dependency;
}
