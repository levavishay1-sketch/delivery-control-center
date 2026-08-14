import { db } from "@/lib/db";

/** The pipeline's current stage, only if it's actually in a draftable state (PENDING/REJECTED). */
export async function getDraftableCurrentStage(pipelineId: string) {
  const pipeline = await db.pipeline.findUnique({
    where: { id: pipelineId },
    include: { stages: { where: { status: { in: ["PENDING", "REJECTED"] } } } },
  });
  if (!pipeline) return { pipeline: null, stage: null };
  const stage = pipeline.stages.find((s) => s.type === pipeline.currentStage) ?? null;
  return { pipeline, stage };
}

export async function getPipelineDetail(id: string) {
  return db.pipeline.findUnique({
    where: { id },
    include: {
      workItem: { include: { project: true } },
      stages: { include: { approvals: { orderBy: { decidedAt: "desc" } } } },
    },
  });
}
