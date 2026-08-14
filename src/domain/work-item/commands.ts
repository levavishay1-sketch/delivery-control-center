import { db } from "@/lib/db";
import { getIntegrationAdapter, decryptIntegrationConfig } from "@/lib/integrations";
import { recordAuditEvent } from "@/lib/audit";
import { createPipeline } from "@/domain/pipeline/commands";
import { getProjectById } from "@/domain/project/queries";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import type { WorkStatus } from "@/generated/prisma/client";

export interface CreateWorkItemInput {
  projectId: string;
  title: string;
  description?: string;
  type?: "PROJECT" | "TASK" | "BUG" | "CHANGE";
  parentId?: string;
  ownerId?: string;
  risk?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  executorType?: "HUMAN" | "AI_AGENT" | "HYBRID" | "UNASSIGNED";
  executorId?: string;
  dueDate?: Date;
}

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
export async function createWorkItem(ctx: AuthContext, input: CreateWorkItemInput) {
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
