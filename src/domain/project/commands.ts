import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma, type ExecutorType, type IntegrationType } from "@/generated/prisma/client";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import { encryptIntegrationConfig } from "@/lib/integrations";
import { DEFAULT_AUTH_TYPE } from "@/domain/connector/commands";
import { recordAuditEvent } from "@/lib/audit";
import { NotFoundError } from "@/domain/shared/errors";

export interface CreateProjectInput {
  clientId: string;
  name: string;
  key: string;
  integrationType?: IntegrationType;
  integrationConfig?: Record<string, unknown>;
}

/**
 * Creates the Project and its Connector together, in the same transaction (design.md decision 1
 * — every Project has exactly one Connector "the same moment it's created"). The connector, not
 * Project, is the sole source of truth for how this project's external tracker is reached
 * (design.md Migration Plan step 4 — Project.integrationType/integrationConfig were dropped once
 * the cutover was verified).
 */
export async function createProject(ctx: AuthContext, input: CreateProjectInput) {
  requireClientRole(ctx, input.clientId, WRITE_ROLES);
  const integrationType = input.integrationType ?? "MANUAL";
  return db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: { clientId: input.clientId, name: input.name, key: input.key },
    });
    await tx.connector.create({
      data: {
        projectId: project.id,
        clientId: input.clientId,
        type: integrationType,
        mode: "PULL",
        authType: DEFAULT_AUTH_TYPE[integrationType],
        syncMode: "MANUAL",
        capabilities: [],
        config: encryptIntegrationConfig(integrationType, input.integrationConfig) as Prisma.InputJsonValue | undefined,
        status: integrationType === "MANUAL" ? "DISCONNECTED" : "CONNECTED",
      },
    });
    return project;
  });
}

/** Sets or clears a project's AI spending limit — overrides its client's if set (design.md Decision 4). `null` means no project-level limit. */
export async function setProjectAiBudget(ctx: AuthContext, projectId: string, budgetUsd: number | null) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  requireClientRole(ctx, project.clientId, WRITE_ROLES);
  return db.project.update({ where: { id: projectId }, data: { aiBudgetUsd: budgetUsd } });
}

const newExecutorSchema = z.object({
  executorType: z.enum(["HUMAN", "AI_AGENT", "HYBRID", "UNASSIGNED"]),
  executorId: z.string().min(1).optional(),
});

export interface NewExecutor {
  executorType: ExecutorType;
  executorId?: string;
}

export interface AssignmentCascadeItem {
  id: string;
  title: string;
  executorType: ExecutorType;
  executorId: string | null;
}

export interface AssignmentCascadePreview {
  affected: AssignmentCascadeItem[]; // currently INHERITED/UNASSIGNED — would move automatically
  unaffected: AssignmentCascadeItem[]; // currently EXPLICIT — would only move under REASSIGN_ALL
}

/**
 * Slice 19 — computes, without writing anything, which of a Project's WorkItems a proposed
 * default-executor change would touch automatically (currently INHERITED, or UNASSIGNED with no
 * assignment of their own) versus which it would leave alone unless the requester explicitly
 * opts to reassign everyone (currently EXPLICIT) — the conflict-detection preview design.md
 * decision 1 requires before any cascade is applied.
 */
export async function previewAssignmentCascade(ctx: AuthContext, projectId: string, rawNewExecutor: NewExecutor): Promise<AssignmentCascadePreview> {
  newExecutorSchema.parse(rawNewExecutor);
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  const items = await db.workItem.findMany({
    where: { projectId },
    select: { id: true, title: true, executorType: true, executorId: true, assignmentSource: true },
    orderBy: { createdAt: "asc" },
  });

  const affected = items.filter((i) => i.assignmentSource === "INHERITED");
  const unaffected = items.filter((i) => i.assignmentSource === "EXPLICIT");

  return {
    affected: affected.map(({ id, title, executorType, executorId }) => ({ id, title, executorType, executorId })),
    unaffected: unaffected.map(({ id, title, executorType, executorId }) => ({ id, title, executorType, executorId })),
  };
}

const applyAssignmentCascadeOptionSchema = z.enum(["INHERITED_ONLY", "REASSIGN_ALL"]);
export type AssignmentCascadeOption = z.infer<typeof applyAssignmentCascadeOptionSchema>;

/**
 * Slice 19 — sets the Project's new default executor and cascades it, in one transaction. Under
 * `INHERITED_ONLY`, only WorkItems already INHERITED or UNASSIGNED move (staying INHERITED);
 * under `REASSIGN_ALL`, every WorkItem moves, and any previously-EXPLICIT one becomes INHERITED
 * (design.md decision 3 — the requester explicitly chose to fold it into the cascade). `option`
 * has no default — the caller must always pass one (design.md decision 2: "no default
 * pre-selected" is enforced at this boundary, not just in the UI).
 */
export async function applyAssignmentCascade(
  ctx: AuthContext,
  projectId: string,
  rawNewExecutor: NewExecutor,
  rawOption: AssignmentCascadeOption
) {
  const newExecutor = newExecutorSchema.parse(rawNewExecutor);
  const option = applyAssignmentCascadeOptionSchema.parse(rawOption);
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  return db.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: { defaultExecutorType: newExecutor.executorType, defaultExecutorId: newExecutor.executorId ?? null },
    });

    const cascadeWhere = option === "REASSIGN_ALL" ? { projectId } : { projectId, assignmentSource: "INHERITED" as const };

    const toReassign = await tx.workItem.findMany({
      where: cascadeWhere,
      select: { id: true, title: true, executorType: true, executorId: true },
    });

    for (const item of toReassign) {
      await tx.workItem.update({
        where: { id: item.id },
        data: {
          executorType: newExecutor.executorType,
          executorId: newExecutor.executorId ?? null,
          assignmentSource: "INHERITED",
        },
      });
      await recordAuditEvent(tx, {
        projectId,
        workItemId: item.id,
        actor: "USER",
        userId: ctx.userId,
        actorName: ctx.displayName,
        action: `${ctx.displayName} reassigned work item "${item.title}" to ${newExecutor.executorType} via a Project default-executor cascade`,
        detail: {
          oldExecutorType: item.executorType,
          oldExecutorId: item.executorId,
          newExecutorType: newExecutor.executorType,
          newExecutorId: newExecutor.executorId ?? null,
          cascadeOption: option,
        },
      });
    }

    await recordAuditEvent(tx, {
      projectId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} changed the Project's default executor to ${newExecutor.executorType} (${option === "REASSIGN_ALL" ? "reassigned all work items" : "applied to unassigned work items only"})`,
      detail: {
        oldDefaultExecutorType: project.defaultExecutorType,
        oldDefaultExecutorId: project.defaultExecutorId,
        newDefaultExecutorType: newExecutor.executorType,
        newDefaultExecutorId: newExecutor.executorId ?? null,
        option,
        reassignedCount: toReassign.length,
      },
    });

    return { reassignedCount: toReassign.length };
  });
}
