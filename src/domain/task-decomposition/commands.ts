import { z } from "zod";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { createWorkItem } from "@/domain/work-item/commands";
import { NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";

const materializeTaskDraftsSchema = z.object({
  taskDraftIds: z.array(z.string().min(1)).min(1),
});

export type MaterializeTaskDraftsInput = z.infer<typeof materializeTaskDraftsSchema>;

/**
 * SDD Activation's next link: turns selected task drafts from an approved TASKS stage into real
 * child WorkItems, reusing createWorkItem verbatim (design.md decision 4). Gated on the stage
 * already being DONE — since TASKS always requires approval (config/workflow.yaml), DONE is only
 * reachable through approveStage's existing gate (design.md decision 2); this action does not
 * participate in that gate itself.
 */
export async function materializeTaskDrafts(ctx: AuthContext, stageId: string, rawInput: MaterializeTaskDraftsInput) {
  const input = materializeTaskDraftsSchema.parse(rawInput);

  const stage = await db.stage.findUnique({
    where: { id: stageId },
    include: { pipeline: { include: { workItem: { include: { project: true } } } }, taskDrafts: true },
  });
  if (!stage) throw new NotFoundError("Stage not found");

  const clientId = stage.pipeline.workItem.project.clientId;
  requireClientRole(ctx, clientId, WRITE_ROLES);

  if (stage.type !== "TASKS" || stage.status !== "DONE") {
    throw new ValidationError("Task drafts can only be materialized from an approved TASKS stage.");
  }

  const draftsById = new Map(stage.taskDrafts.map((d) => [d.id, d]));
  const selected = input.taskDraftIds.map((id) => {
    const draft = draftsById.get(id);
    if (!draft) throw new NotFoundError(`Task draft ${id} not found on this stage`);
    if (draft.materializedWorkItemId) {
      throw new ValidationError(`Task draft "${draft.title}" has already been materialized`);
    }
    return draft;
  });

  const created = [];
  for (const draft of selected) {
    const { workItem } = await createWorkItem(ctx, {
      projectId: stage.pipeline.workItem.projectId,
      parentId: stage.pipeline.workItem.id,
      title: draft.title,
      description: draft.description ?? undefined,
      type: "TASK",
    });
    await db.taskDraft.update({ where: { id: draft.id }, data: { materializedWorkItemId: workItem.id } });
    created.push({ draft, workItem });
  }

  await recordAuditEvent(db, {
    projectId: stage.pipeline.workItem.projectId,
    workItemId: stage.pipeline.workItem.id,
    actor: "USER",
    userId: ctx.userId,
    actorName: ctx.displayName,
    action: `${ctx.displayName} materialized ${created.length} task(s) from the Tasks stage into child Work Items`,
    detail: { stageId, workItemIds: created.map((c) => c.workItem.id) },
  });

  return created.map((c) => c.workItem);
}
