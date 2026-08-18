import { z } from "zod";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { getWorkItemById } from "@/domain/work-item/queries";
import { getProjectById } from "@/domain/project/queries";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";

const createDecisionSchema = z.object({
  workItemId: z.string().min(1),
  question: z.string().min(1).max(2000),
  reason: z.string().min(1).max(2000),
  impact: z.string().min(1).max(2000),
  aiRecommendation: z.string().max(5000).optional(),
  aiConfidence: z.number().min(0).max(100).optional(),
  deadline: z.coerce.date().optional(),
});

export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;

/**
 * Creates a decision on a work item. Side effect: sets work item status to DECISION_REQUIRED.
 * Authorization: WRITE_ROLES (Manager+).
 */
export async function createDecision(ctx: AuthContext, rawInput: CreateDecisionInput) {
  const input = createDecisionSchema.parse(rawInput);

  const workItem = await getWorkItemById(input.workItemId);
  if (!workItem) throw new NotFoundError("Work item not found");

  const project = await getProjectById(workItem.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  const decision = await db.$transaction(async (tx) => {
    const created = await tx.decision.create({
      data: {
        workItemId: input.workItemId,
        question: input.question,
        reason: input.reason,
        impact: input.impact,
        aiRecommendation: input.aiRecommendation,
        aiConfidence: input.aiConfidence ?? null,
        deadline: input.deadline,
        status: "OPEN",
      },
      include: { workItem: true },
    });

    // Side effect: set work item status to DECISION_REQUIRED
    await tx.workItem.update({
      where: { id: input.workItemId },
      data: { status: "DECISION_REQUIRED" },
    });

    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId: input.workItemId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} created decision on "${created.workItem.title}": ${input.question}`,
      detail: { question: input.question, reason: input.reason } as Record<string, unknown>,
    });

    return created;
  });

  return decision;
}

/**
 * Approves a decision. Authorization: any authenticated user.
 * Side effect: restores work item to OPEN or IN_PROGRESS (we choose OPEN as default).
 */
export async function approveDecision(ctx: AuthContext, decisionId: string) {
  const existing = await db.decision.findUnique({
    where: { id: decisionId },
    include: { workItem: true },
  });
  if (!existing) throw new NotFoundError("Decision not found");
  if (existing.status !== "OPEN") throw new ValidationError("Decision is not open for approval");

  const project = await getProjectById(existing.workItem.projectId);
  if (!project) throw new NotFoundError("Project not found");

  const decision = await db.$transaction(async (tx) => {
    const updated = await tx.decision.update({
      where: { id: decisionId },
      data: {
        status: "APPROVED",
        approverId: ctx.userId,
        resolvedAt: new Date(),
      },
      include: { workItem: true },
    });

    // Restore work item status to OPEN (safest default)
    await tx.workItem.update({
      where: { id: existing.workItem.id },
      data: { status: "OPEN" },
    });

    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId: existing.workItem.id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} approved decision on "${updated.workItem.title}"`,
    });

    return updated;
  });

  return decision;
}

/**
 * Rejects a decision. Authorization: any authenticated user.
 * Side effect: keeps work item status as DECISION_REQUIRED (no state change).
 */
export async function rejectDecision(ctx: AuthContext, decisionId: string, reason?: string) {
  const existing = await db.decision.findUnique({
    where: { id: decisionId },
    include: { workItem: true },
  });
  if (!existing) throw new NotFoundError("Decision not found");
  if (existing.status !== "OPEN") throw new ValidationError("Decision is not open for rejection");

  const project = await getProjectById(existing.workItem.projectId);
  if (!project) throw new NotFoundError("Project not found");

  const decision = await db.$transaction(async (tx) => {
    const updated = await tx.decision.update({
      where: { id: decisionId },
      data: {
        status: "REJECTED",
        approverId: ctx.userId,
        resolvedAt: new Date(),
      },
      include: { workItem: true },
    });

    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId: existing.workItem.id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} rejected decision on "${updated.workItem.title}"`,
      detail: reason ? { reason } : undefined,
    });

    return updated;
  });

  return decision;
}
