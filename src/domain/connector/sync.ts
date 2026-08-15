import { db } from "@/lib/db";
import { getIntegrationAdapter, decryptIntegrationConfig } from "@/lib/integrations";
import { recordAuditEvent } from "@/lib/audit";
import { mapExternalStatus } from "@/domain/work-item/commands";
import { NotFoundError } from "@/domain/shared/errors";
import type { WorkStatus } from "@/generated/prisma/client";

export interface SyncCounts {
  itemsCreated: number;
  itemsUpdated: number;
  itemsConflicted: number;
}

/**
 * The actual sync execution: fetches from a connector's adapter and upserts WorkItem rows.
 * Trusted, internal — no ctx/authz here; the only caller is the worker's SYNC_PROJECT job
 * handler, reached only through triggerSync's WRITE_ROLES-gated enqueue
 * (src/domain/connector/commands.ts). Conflict detection against manually-edited fields is added
 * in Task Group 4 — itemsConflicted stays 0 until then.
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

    await db.workItem.upsert({
      where: externalKey,
      update: {
        title: item.title,
        description: item.description,
        status,
        externalUrl: item.externalUrl,
        syncedAt: new Date(),
      },
      create: {
        projectId: project.id,
        source: connector.type,
        externalId: item.externalId,
        externalUrl: item.externalUrl,
        title: item.title,
        description: item.description,
        status,
      },
    });

    if (existing) itemsUpdated++;
    else itemsCreated++;
  }

  await recordAuditEvent(db, {
    projectId: project.id,
    actor: "SYSTEM",
    action: `Synced ${fetched.length} work item(s) from ${connector.type} for project "${project.name}"`,
    detail: { synced: fetched.length, newWorkItems: itemsCreated, updatedWorkItems: itemsUpdated },
  });

  return { itemsCreated, itemsUpdated, itemsConflicted: 0 };
}
