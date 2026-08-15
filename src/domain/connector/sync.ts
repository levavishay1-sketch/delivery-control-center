import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { getIntegrationAdapter, decryptIntegrationConfig } from "@/lib/integrations";
import { recordAuditEvent } from "@/lib/audit";
import { mapExternalStatus } from "@/domain/work-item/commands";
import { recordSyncProvenance } from "@/domain/connector/provenance";
import { createOrUpdateSyncConflict } from "@/domain/connector/conflicts";
import { NotFoundError } from "@/domain/shared/errors";
import type { WorkStatus } from "@/generated/prisma/client";

export interface SyncCounts {
  itemsCreated: number;
  itemsUpdated: number;
  itemsConflicted: number;
}

/** The work-item fields a sync can write — exactly what FetchedWorkItem returns, and the only fields field-provenance/conflict tracking applies to (design.md Non-Goals). */
const SYNCABLE_FIELDS = ["title", "description", "status", "externalUrl"] as const;
type SyncableField = (typeof SYNCABLE_FIELDS)[number];

/**
 * The actual sync execution: fetches from a connector's adapter and upserts WorkItem rows.
 * Trusted, internal — no ctx/authz here; the only caller is the worker's SYNC_PROJECT job
 * handler, reached only through triggerSync's WRITE_ROLES-gated enqueue
 * (src/domain/connector/commands.ts).
 *
 * A field whose current provenance shows a human last edited it, and whose incoming value
 * differs from what's currently stored, is never overwritten (design.md decision 3): it's left
 * untouched and a SyncConflict is recorded instead. Every other field writes normally and its
 * provenance is recorded as SYNC.
 */
export async function runConnectorSync(connectorId: string): Promise<SyncCounts> {
  const connector = await db.connector.findUnique({ where: { id: connectorId } });
  if (!connector) throw new NotFoundError("Connector not found");
  const project = await db.project.findUnique({ where: { id: connector.projectId } });
  if (!project) throw new NotFoundError("Project not found");

  const adapter = getIntegrationAdapter(connector.type);
  const decryptedConfig = decryptIntegrationConfig(connector.type, connector.config as Record<string, unknown> | null);
  const fetched = await adapter.fetchWorkItems(decryptedConfig as Record<string, unknown> | null);

  let itemsCreated = 0;
  let itemsUpdated = 0;
  let itemsConflicted = 0;

  for (const item of fetched) {
    const status: WorkStatus = mapExternalStatus(item.status);
    const externalKey = {
      projectId_source_externalId: {
        projectId: project.id,
        source: connector.type,
        externalId: item.externalId,
      },
    };
    const existing = await db.workItem.findUnique({ where: externalKey });

    const incoming: Record<SyncableField, string | undefined> = {
      title: item.title,
      description: item.description,
      status,
      externalUrl: item.externalUrl,
    };

    if (!existing) {
      const created = await db.workItem.create({
        data: {
          projectId: project.id,
          source: connector.type,
          externalId: item.externalId,
          externalUrl: item.externalUrl,
          title: item.title,
          description: item.description,
          status,
        },
      });
      for (const field of SYNCABLE_FIELDS) {
        if (incoming[field] !== undefined) await recordSyncProvenance(created.id, field, item.externalId);
      }
      itemsCreated++;
      continue;
    }

    const provenanceRows = await db.fieldProvenance.findMany({ where: { workItemId: existing.id } });
    const provenanceByField = new Map(provenanceRows.map((p) => [p.field, p]));
    const existingByField = existing as unknown as Record<SyncableField, string | null>;

    const updateData: Prisma.WorkItemUpdateInput = {};
    const writtenFields: SyncableField[] = [];
    let conflictedFieldCount = 0;

    for (const field of SYNCABLE_FIELDS) {
      const incomingValue = incoming[field];
      if (incomingValue === undefined) continue;

      const currentValue = existingByField[field] ?? "";
      const provenance = provenanceByField.get(field);

      if (provenance?.source === "MANUAL" && currentValue !== incomingValue) {
        await createOrUpdateSyncConflict(existing.id, field, currentValue, incomingValue, connectorId);
        conflictedFieldCount++;
        continue;
      }

      (updateData as Record<string, string>)[field] = incomingValue;
      writtenFields.push(field);
    }

    if (conflictedFieldCount > 0) itemsConflicted++;

    await db.workItem.update({
      where: { id: existing.id },
      data: { ...updateData, syncedAt: new Date() },
    });

    for (const field of writtenFields) {
      await recordSyncProvenance(existing.id, field, item.externalId);
    }

    itemsUpdated++;
  }

  await recordAuditEvent(db, {
    projectId: project.id,
    actor: "SYSTEM",
    action: `Synced ${fetched.length} work item(s) from ${connector.type} for project "${project.name}"`,
    detail: { synced: fetched.length, newWorkItems: itemsCreated, updatedWorkItems: itemsUpdated, conflicted: itemsConflicted },
  });

  return { itemsCreated, itemsUpdated, itemsConflicted };
}
