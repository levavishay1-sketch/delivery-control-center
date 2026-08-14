import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getIntegrationAdapter } from "@/lib/integrations";
import { createPipeline } from "@/lib/pipeline";
import { recordAuditEvent } from "@/lib/audit";

export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/sync">) {
  const { id } = await ctx.params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

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

  return NextResponse.json({ synced: fetched.length, newPipelines: created.length });
}
