import { db } from "@/lib/db";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, ALL_ROLES, WRITE_ROLES } from "@/domain/shared/authz";

/** The pipeline's current stage, only if it's actually in a draftable state (PENDING/REJECTED). Requires write access. */
export async function getDraftableCurrentStage(ctx: AuthContext, pipelineId: string) {
  const pipeline = await db.pipeline.findUnique({
    where: { id: pipelineId },
    include: {
      workItem: { include: { project: true } },
      stages: { where: { status: { in: ["PENDING", "REJECTED"] } } },
    },
  });
  if (!pipeline) return { pipeline: null, stage: null };
  requireClientRole(ctx, pipeline.workItem.project.clientId, WRITE_ROLES);
  const stage = pipeline.stages.find((s) => s.type === pipeline.currentStage) ?? null;
  return { pipeline, stage };
}

/** A stage's current status, for the DraftButton's lightweight status poll while a draft is in flight. Requires at least read access. */
export async function getStageStatus(ctx: AuthContext, stageId: string) {
  const stage = await db.stage.findUnique({
    where: { id: stageId },
    include: { pipeline: { include: { workItem: { include: { project: true } } } } },
  });
  if (!stage) return null;
  requireClientRole(ctx, stage.pipeline.workItem.project.clientId, ALL_ROLES);
  return stage;
}

/** Full pipeline detail for display. Requires at least read access to the owning client. */
export async function getPipelineDetail(ctx: AuthContext, id: string) {
  const pipeline = await db.pipeline.findUnique({
    where: { id },
    include: {
      workItem: { include: { project: true } },
      stages: { include: { approvals: { orderBy: { decidedAt: "desc" } } } },
    },
  });
  if (!pipeline) return null;
  requireClientRole(ctx, pipeline.workItem.project.clientId, ALL_ROLES);
  return pipeline;
}
