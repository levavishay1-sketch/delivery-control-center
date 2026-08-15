import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { recordSyncProvenance } from "@/domain/connector/provenance";
import { getProjectById } from "@/domain/project/queries";
import { requireClientRole, ALL_ROLES, WRITE_ROLES } from "@/domain/shared/authz";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";
import type { WorkStatus } from "@/generated/prisma/client";

type DbClient = typeof db | Prisma.TransactionClient;

/**
 * Creates or updates the open SyncConflict for a work item's field. Upserted, not append-only
 * (design.md decision 4): the row represents current disagreement, not a history — a later sync
 * while one is still open (or a new disagreement after an earlier one was resolved) replaces
 * incomingValue/resets resolution rather than stacking a second row for the same field.
 */
export async function createOrUpdateSyncConflict(
  workItemId: string,
  field: string,
  currentValue: string,
  incomingValue: string,
  connectorId: string,
  client: DbClient = db
) {
  return client.syncConflict.upsert({
    where: { workItemId_field: { workItemId, field } },
    create: { workItemId, field, currentValue, incomingValue, connectorId },
    update: { currentValue, incomingValue, connectorId, resolvedAt: null, resolvedByUserId: null, resolution: null },
  });
}

/** Every unresolved conflict for a project's work items, most recent first — visible to any read-capable role. */
export async function listOpenConflicts(ctx: AuthContext, projectId: string) {
  const project = await getProjectById(projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, ALL_ROLES);

  return db.syncConflict.findMany({
    where: { resolvedAt: null, workItem: { projectId } },
    include: { workItem: true },
    orderBy: { createdAt: "desc" },
  });
}

function buildFieldUpdateData(field: string, value: string): Prisma.WorkItemUpdateInput {
  switch (field) {
    case "title":
      return { title: value };
    case "description":
      return { description: value };
    case "status":
      return { status: value as WorkStatus };
    case "externalUrl":
      return { externalUrl: value };
    default:
      throw new ValidationError(`Unknown synced field: ${field}`);
  }
}

const resolutionSchema = z.enum(["KEPT_MANUAL", "ACCEPTED_INCOMING"]);

/**
 * Resolves an open conflict: KEPT_MANUAL just closes the row (the field itself was never
 * touched — it's been the manual value all along, per design.md's manual-wins default).
 * ACCEPTED_INCOMING writes the incoming value to the work item and re-records its provenance as
 * SYNC before closing the row. Either way, the resolution is audited in the same transaction.
 */
export async function resolveConflict(ctx: AuthContext, conflictId: string, rawResolution: string) {
  const resolution = resolutionSchema.parse(rawResolution);
  const conflict = await db.syncConflict.findUnique({
    where: { id: conflictId },
    include: { workItem: { include: { project: true } } },
  });
  if (!conflict) throw new NotFoundError("Conflict not found");
  if (conflict.resolvedAt) throw new ValidationError("This conflict has already been resolved.");
  requireClientRole(ctx, conflict.workItem.project.clientId, WRITE_ROLES);

  return db.$transaction(async (tx) => {
    if (resolution === "ACCEPTED_INCOMING") {
      await tx.workItem.update({
        where: { id: conflict.workItemId },
        data: buildFieldUpdateData(conflict.field, conflict.incomingValue),
      });
      await recordSyncProvenance(conflict.workItemId, conflict.field, conflict.workItem.externalId, tx);
    }

    const resolved = await tx.syncConflict.update({
      where: { id: conflictId },
      data: { resolvedAt: new Date(), resolvedByUserId: ctx.userId, resolution },
    });

    await recordAuditEvent(tx, {
      projectId: conflict.workItem.projectId,
      workItemId: conflict.workItemId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} resolved a sync conflict on "${conflict.field}" (${
        resolution === "KEPT_MANUAL" ? "kept manual value" : "accepted incoming value"
      })`,
    });

    return resolved;
  });
}
