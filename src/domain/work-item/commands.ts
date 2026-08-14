import { z } from "zod";
import { db } from "@/lib/db";
import { getIntegrationAdapter, decryptIntegrationConfig } from "@/lib/integrations";
import { recordAuditEvent } from "@/lib/audit";
import { createPipeline } from "@/domain/pipeline/commands";
import { getProjectById } from "@/domain/project/queries";
import { getWorkItemById } from "@/domain/work-item/queries";
import { assertValidTransition } from "@/domain/work-item/status";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import type { WorkStatus } from "@/generated/prisma/client";

const workItemTypeSchema = z.enum(["PROJECT", "TASK", "BUG", "CHANGE"]);
const riskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const priorityLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const executorTypeSchema = z.enum(["HUMAN", "AI_AGENT", "HYBRID", "UNASSIGNED"]);
// DECISION_REQUIRED and BLOCKED are excluded here — see status.ts — they're only ever
// entered as a side effect of createDecision/createBlocker, never a manual request.
const manualWorkStatusSchema = z.enum(["DRAFT", "OPEN", "IN_PROGRESS", "REVIEW", "APPROVED", "COMPLETED", "CLOSED"]);

const createWorkItemSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).optional(),
  type: workItemTypeSchema.optional(),
  parentId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  risk: riskLevelSchema.optional(),
  priority: priorityLevelSchema.optional(),
  executorType: executorTypeSchema.optional(),
  executorId: z.string().min(1).optional(),
  dueDate: z.coerce.date().optional(),
});

export type CreateWorkItemInput = z.infer<typeof createWorkItemSchema>;

const updateWorkItemSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10_000).optional(),
  risk: riskLevelSchema.optional(),
  priority: priorityLevelSchema.optional(),
  ownerId: z.string().min(1).optional(),
  executorType: executorTypeSchema.optional(),
  executorId: z.string().min(1).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
});

export type UpdateWorkItemInput = z.infer<typeof updateWorkItemSchema>;

/**
 * External systems (Jira, Azure DevOps) report status as arbitrary free text
 * ("To Do", "In Progress", "Done", ...) with no fixed value set. Maps the raw
 * string onto our 9-state WorkStatus, defaulting unrecognized values to OPEN
 * rather than guessing — see PRODUCT_SPEC.md gap #3 and design.md's "Synced
 * work items" edge case.
 */
function mapExternalStatus(raw: string): WorkStatus {
  const normalized = raw.trim().toLowerCase();
  if (["done", "complete", "completed", "closed", "resolved"].includes(normalized)) return "COMPLETED";
  if (["in progress", "in review", "reviewing"].includes(normalized)) {
    return normalized === "in review" || normalized === "reviewing" ? "REVIEW" : "IN_PROGRESS";
  }
  if (["blocked", "on hold"].includes(normalized)) return "BLOCKED";
  if (["to do", "open", "backlog", "new"].includes(normalized)) return "OPEN";
  return "OPEN";
}

/** Adds a work item by hand (the "manual" integration path) and starts its pipeline. */
export async function createWorkItem(ctx: AuthContext, rawInput: CreateWorkItemInput) {
  const input = createWorkItemSchema.parse(rawInput);
  const project = await getProjectById(input.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  if (input.parentId) {
    const parent = await db.workItem.findUnique({ where: { id: input.parentId } });
    if (!parent || parent.projectId !== input.projectId) {
      throw new ValidationError("Parent work item must exist in the same project.");
    }
  }

  const workItem = await db.$transaction(async (tx) => {
    const created = await tx.workItem.create({
      data: {
        projectId: input.projectId,
        source: "MANUAL",
        externalId: `manual-${Date.now()}`,
        title: input.title,
        description: input.description,
        status: "OPEN",
        type: input.type ?? "TASK",
        parentId: input.parentId,
        ownerId: input.ownerId ?? ctx.userId,
        risk: input.risk ?? "MEDIUM",
        priority: input.priority ?? "MEDIUM",
        executorType: input.executorType ?? "UNASSIGNED",
        executorId: input.executorId,
        dueDate: input.dueDate,
      },
    });
    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId: created.id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} created work item "${created.title}"`,
    });
    return created;
  });

  const pipeline = await createPipeline(workItem.id);
  return { workItem, pipeline };
}

/** Updates a work item's editable fields (not status — see updateWorkItemStatus). */
export async function updateWorkItem(ctx: AuthContext, id: string, rawInput: UpdateWorkItemInput) {
  const input = updateWorkItemSchema.parse(rawInput);
  const existing = await getWorkItemById(id);
  if (!existing) throw new NotFoundError("Work item not found");
  const project = await getProjectById(existing.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  return db.$transaction(async (tx) => {
    const updated = await tx.workItem.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        risk: input.risk,
        priority: input.priority,
        ownerId: input.ownerId,
        executorType: input.executorType,
        executorId: input.executorId,
        dueDate: input.dueDate,
        progress: input.progress,
      },
    });
    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId: id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} updated work item "${updated.title}"`,
      detail: rawInput as Record<string, unknown>,
    });
    return updated;
  });
}

/**
 * Transitions a work item's status. DECISION_REQUIRED and BLOCKED are not
 * reachable through this command in either direction — see status.ts.
 */
export async function updateWorkItemStatus(ctx: AuthContext, id: string, rawStatus: string, reason?: string) {
  const newStatus = manualWorkStatusSchema.parse(rawStatus);
  const existing = await getWorkItemById(id);
  if (!existing) throw new NotFoundError("Work item not found");
  const project = await getProjectById(existing.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  assertValidTransition(existing.status, newStatus);

  return db.$transaction(async (tx) => {
    const updated = await tx.workItem.update({ where: { id }, data: { status: newStatus } });
    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId: id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} moved "${updated.title}" from ${existing.status} to ${newStatus}`,
      detail: reason ? { from: existing.status, to: newStatus, reason } : { from: existing.status, to: newStatus },
    });
    return updated;
  });
}

/** Makes childId a child of parentId. Both must exist in the same project; rejects cycles. */
export async function addParentWorkItem(ctx: AuthContext, childId: string, parentId: string) {
  if (childId === parentId) throw new ValidationError("A work item cannot be its own parent.");

  const child = await getWorkItemById(childId);
  if (!child) throw new NotFoundError("Work item not found");
  const parent = await getWorkItemById(parentId);
  if (!parent) throw new NotFoundError("Parent work item not found");
  if (child.projectId !== parent.projectId) {
    throw new ValidationError("A work item can only be a child of a work item in the same project.");
  }

  const project = await getProjectById(child.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  // Cycle check: walk parent's ancestor chain; reject if childId appears in it.
  let cursor: string | null = parent.id;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === childId) {
      throw new ValidationError("This would create a cycle in the work-item hierarchy.");
    }
    if (seen.has(cursor)) break; // defensive: pre-existing cycle shouldn't infinite-loop this check
    seen.add(cursor);
    const node: { parentId: string | null } | null = await db.workItem.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = node?.parentId ?? null;
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.workItem.update({ where: { id: childId }, data: { parentId } });
    await recordAuditEvent(tx, {
      projectId: project.id,
      workItemId: childId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} made "${child.title}" a child of "${parent.title}"`,
    });
    return updated;
  });
}

/** Pulls work items from a project's configured integration, upserting and starting pipelines for new ones. */
export async function syncProjectWorkItems(ctx: AuthContext, projectId: string) {
  const project = await getProjectById(projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  const adapter = getIntegrationAdapter(project.integrationType);
  const decryptedConfig = decryptIntegrationConfig(
    project.integrationType,
    project.integrationConfig as Record<string, unknown> | null
  );
  const fetched = await adapter.fetchWorkItems(decryptedConfig as Record<string, unknown> | null);

  const created: string[] = [];
  for (const item of fetched) {
    const status: WorkStatus = mapExternalStatus(item.status);
    const workItem = await db.workItem.upsert({
      where: {
        projectId_source_externalId: {
          projectId: project.id,
          source: project.integrationType,
          externalId: item.externalId,
        },
      },
      update: {
        title: item.title,
        description: item.description,
        status,
        externalUrl: item.externalUrl,
        syncedAt: new Date(),
      },
      create: {
        projectId: project.id,
        source: project.integrationType,
        externalId: item.externalId,
        externalUrl: item.externalUrl,
        title: item.title,
        description: item.description,
        status,
      },
      include: { pipeline: true },
    });

    if (!workItem.pipeline) {
      await createPipeline(workItem.id);
      created.push(workItem.id);
    }
  }

  await recordAuditEvent(db, {
    projectId: project.id,
    actor: "SYSTEM",
    action: `Synced ${fetched.length} work item(s) from ${project.integrationType} for project "${project.name}"`,
    detail: { synced: fetched.length, newPipelines: created.length },
  });

  return { synced: fetched.length, newPipelines: created.length };
}
