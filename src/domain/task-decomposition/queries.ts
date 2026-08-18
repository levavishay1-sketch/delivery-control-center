import { db } from "@/lib/db";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";
import { NotFoundError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";

/** A TASKS stage's task drafts, oldest first — readable by anyone with read access to the client. */
export async function listTaskDraftsForStage(ctx: AuthContext, stageId: string) {
  const stage = await db.stage.findUnique({
    where: { id: stageId },
    include: { pipeline: { include: { workItem: { include: { project: true } } } } },
  });
  if (!stage) throw new NotFoundError("Stage not found");
  requireClientRole(ctx, stage.pipeline.workItem.project.clientId, ALL_ROLES);

  return db.taskDraft.findMany({
    where: { stageId },
    orderBy: { createdAt: "asc" },
    include: { materializedWorkItem: { select: { id: true, title: true } } },
  });
}
