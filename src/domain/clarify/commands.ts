import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { enqueueJob } from "@/domain/job/commands";
import { ConflictError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import type { ClarifyQuestion } from "@/generated/prisma/client";

/**
 * Answers one outstanding clarification question. If this was the last
 * unanswered question for its stage, the stage moves back to AI_DRAFTING and
 * a fresh DRAFT_STAGE job is enqueued (atomically, in the same transaction —
 * see the same crash-durability reasoning as draftStage) with every answered
 * question available to the redraft via context.clarifyAnswers.
 */
export async function answerClarifyQuestion(
  ctx: AuthContext,
  questionId: string,
  answer: string
): Promise<{ question: ClarifyQuestion; resumedDrafting: boolean }> {
  const question = await db.clarifyQuestion.findUniqueOrThrow({
    where: { id: questionId },
    include: { stage: { include: { pipeline: { include: { workItem: { include: { project: true } } } } } } },
  });
  requireClientRole(ctx, question.stage.pipeline.workItem.project.clientId, WRITE_ROLES);

  if (question.answer !== null) {
    throw new ConflictError("This question has already been answered.");
  }
  if (question.stage.status !== "AWAITING_CLARIFICATION") {
    throw new ConflictError(`Stage is ${question.stage.status}; not awaiting clarification.`);
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.clarifyQuestion.update({
      where: { id: questionId },
      data: { answer, answeredByUserId: ctx.userId, answeredAt: new Date() },
    });

    await recordAuditEvent(tx, {
      pipelineId: question.stage.pipeline.id,
      stageId: question.stage.id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} answered a clarification question`,
      detail: { question: question.question, answer },
    });

    const remainingUnanswered = await tx.clarifyQuestion.count({
      where: { stageId: question.stageId, answer: null },
    });

    let resumedDrafting = false;
    if (remainingUnanswered === 0) {
      await tx.stage.update({ where: { id: question.stageId }, data: { status: "AI_DRAFTING" } });
      await enqueueJob(
        "DRAFT_STAGE",
        { stageId: question.stageId },
        `draft-stage-${question.stageId}-${Date.now()}`,
        tx
      );
      resumedDrafting = true;
    }

    return { question: updated, resumedDrafting };
  });
}
