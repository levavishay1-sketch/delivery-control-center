import { db } from "@/lib/db";
import { getIntegrationAdapter } from "@/lib/integrations";
import { recordAuditEvent } from "@/lib/audit";
import { createPipeline } from "@/domain/pipeline/commands";
import { getProjectById } from "@/domain/project/queries";
import { NotFoundError } from "@/domain/shared/errors";

export interface CreateWorkItemInput {
  projectId: string;
  title: string;
  description?: string;
}

/** Adds a work item by hand (the "manual" integration path) and starts its pipeline. */
export async function createWorkItem(input: CreateWorkItemInput) {
  const workItem = await db.workItem.create({
    data: {
      projectId: input.projectId,
      source: "MANUAL",
      externalId: `manual-${Date.now()}`,
      title: input.title,
      description: input.description,
      status: "open",
    },
  });

  const pipeline = await createPipeline(workItem.id);
  return { workItem, pipeline };
}

/** Pulls work items from a project's configured integration, upserting and starting pipelines for new ones. */
export async function syncProjectWorkItems(projectId: string) {
  const project = await getProjectById(projectId);
  if (!project) throw new NotFoundError("Project not found");

  const adapter = getIntegrationAdapter(project.integrationType);
  const fetched = await adapter.fetchWorkItems(project.integrationConfig as Record<string, unknown> | null);

  const created: string[] = [];
  for (const item of fetched) {
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
        status: item.status,
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
        status: item.status,
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
