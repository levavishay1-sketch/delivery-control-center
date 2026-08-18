import { z } from "zod";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { getWorkItemById } from "@/domain/work-item/queries";
import { getProjectById } from "@/domain/project/queries";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";

const createBlockerSchema = z.object({
  blockingItemId: z.string().min(1),
  reason: z.string().min(1).max(2000),
  requiredAction: z.string().min(1).max(2000),
  ownerId: z.string().min(1),
  impact: z.string().max(2000).optional(),
});

export type CreateBlockerInput = z.infer<typeof createBlockerSchema>;

const updateBlockerSchema = z.object({
  reason: z.string().min(1).max(2000).optional(),
  requiredAction: z.string().min(1).max(2000).optional(),
  impact: z.string().max(2000).optional(),
  ownerId: z.string().min(1).optional(),
});

export type UpdateBlockerInput = z.infer<typeof updateBlockerSchema>;

/**
 * Creates a blocker on a work item. Side effect: sets work item status to BLOCKED.
 * Authorization: WRITE_ROLES (Manager+).
 */
export async function createBlocker(ctx: AuthContext, rawInput: CreateBlockerInput) {
  const input = createBlockerSchema.parse(rawInput);

  const workItem = await getWorkItemById(input.blockingItemId);
  if (!workItem) throw new NotFoundError("Work item not found");

  const project = await getProjectById(workItem.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  const owner = await db.user.findUnique({ where: { id: input.ownerId } });
  if (!owner) throw new NotFoundError("Owner user not found");

  const blocker = await db.$transaction(async (tx) => {
    const created = await tx.blocker.create({
      data: {
        blockingItemId: input.blockingItemId,
        ownerId: input.ownerId,
        reason: input.reason,
        requiredAction: input.requiredAction,
        impact: input.impact,
      },
      include: { blockingItem: true, owner: true },
    });

    // Side effect: set work item status to BLOCKED
    await tx.workItem.update({
      where: { id: input.blockingItemId },
      data: { status: "BLOCKED" },
    });

    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId: input.blockingItemId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} created blocker on "${created.blockingItem.title}": ${input.reason}`,
      detail: { reason: input.reason, requiredAction: input.requiredAction } as Record<string, unknown>,
    });

    return created;
  });

  return blocker;
}

/**
 * Updates a blocker's fields. Authorization: blocker owner or WRITE_ROLES.
 */
export async function updateBlocker(ctx: AuthContext, blockerId: string, rawInput: UpdateBlockerInput) {
  const input = updateBlockerSchema.parse(rawInput);

  const existing = await db.blocker.findUnique({
    where: { id: blockerId },
    include: { blockingItem: true },
  });
  if (!existing) throw new NotFoundError("Blocker not found");

  const project = await getProjectById(existing.blockingItem.projectId);
  if (!project) throw new NotFoundError("Project not found");

  // Authorization: blocker owner or WRITE_ROLES
  const isBlockerOwner = existing.ownerId === ctx.userId;
  if (!isBlockerOwner) {
    requireClientRole(ctx, project.clientId, WRITE_ROLES);
  }

  const blocker = await db.$transaction(async (tx) => {
    const updated = await tx.blocker.update({
      where: { id: blockerId },
      data: {
        reason: input.reason,
        requiredAction: input.requiredAction,
        impact: input.impact,
        ownerId: input.ownerId,
      },
      include: { blockingItem: true },
    });

    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId: existing.blockingItem.id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} updated blocker on "${updated.blockingItem.title}"`,
      detail: input as Record<string, unknown>,
    });

    return updated;
  });

  return blocker;
}

/**
 * Resolves a blocker. Side effect: if no other active blockers exist,
 * restores work item status to its prior non-blocked state (OPEN or IN_PROGRESS).
 * Authorization: blocker owner or WRITE_ROLES.
 */
export async function resolveBlocker(ctx: AuthContext, blockerId: string) {
  const existing = await db.blocker.findUnique({
    where: { id: blockerId },
    include: { blockingItem: true },
  });
  if (!existing) throw new NotFoundError("Blocker not found");
  if (existing.resolvedAt) throw new ValidationError("Blocker is already resolved");

  const project = await getProjectById(existing.blockingItem.projectId);
  if (!project) throw new NotFoundError("Project not found");

  // Authorization: blocker owner or WRITE_ROLES
  const isBlockerOwner = existing.ownerId === ctx.userId;
  if (!isBlockerOwner) {
    requireClientRole(ctx, project.clientId, WRITE_ROLES);
  }

  const blocker = await db.$transaction(async (tx) => {
    const updated = await tx.blocker.update({
      where: { id: blockerId },
      data: { resolvedAt: new Date() },
      include: { blockingItem: true },
    });

    // Check if any other active blockers remain for this work item
    const activeCount = await tx.blocker.count({
      where: {
        blockingItemId: existing.blockingItem.id,
        resolvedAt: null,
      },
    });

    // If no other blockers, restore status to OPEN (safest default when all blockers resolved)
    if (activeCount === 0) {
      await tx.workItem.update({
        where: { id: existing.blockingItem.id },
        data: { status: "OPEN" },
      });
    }

    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId: existing.blockingItem.id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} resolved blocker on "${updated.blockingItem.title}"`,
    });

    return updated;
  });

  return blocker;
}
