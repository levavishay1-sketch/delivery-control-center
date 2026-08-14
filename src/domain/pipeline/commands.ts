import { db } from "@/lib/db";
import { getFirstStageType, getNextStageType, getStageConfig } from "@/lib/config";
import { recordAuditEvent } from "@/lib/audit";
import { getAgentExecutor } from "@/lib/agents";
import type { Prisma, StageType } from "@/generated/prisma/client";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";

/** Creates a Pipeline for a work item, seeded with its first (PENDING) stage. */
export async function createPipeline(workItemId: string) {
  return db.$transaction(async (tx) => {
    const workItem = await tx.workItem.findUniqueOrThrow({ where: { id: workItemId } });
    const firstStage = getFirstStageType();

    const pipeline = await tx.pipeline.create({
      data: {
        workItemId: workItem.id,
        currentStage: firstStage,
        stages: { create: { type: firstStage } },
      },
      include: { stages: true },
    });

    await recordAuditEvent(tx, {
      pipelineId: pipeline.id,
      actor: "SYSTEM",
      action: `Pipeline created for "${workItem.title}"`,
      detail: { workItemId: workItem.id, firstStage },
    });

    return pipeline;
  });
}

/**
 * Advances the pipeline past a just-completed stage: creates the next configured stage, or
 * marks the pipeline COMPLETED if there isn't one. Shared by approveStage and draftStage's
 * requiresApproval:false auto-complete path — both reach this the same way a human approval does.
 */
async function advancePipelinePastStage(tx: Prisma.TransactionClient, pipelineId: string, completedStageType: StageType) {
  const nextType = getNextStageType(completedStageType);
  if (nextType) {
    await tx.stage.create({ data: { pipelineId, type: nextType } });
    await tx.pipeline.update({ where: { id: pipelineId }, data: { currentStage: nextType } });
    await recordAuditEvent(tx, {
      pipelineId,
      actor: "SYSTEM",
      action: `Pipeline advanced to ${getStageConfig(nextType).label}`,
    });
  } else {
    await tx.pipeline.update({ where: { id: pipelineId }, data: { status: "COMPLETED" } });
    await recordAuditEvent(tx, {
      pipelineId,
      actor: "SYSTEM",
      action: "Pipeline completed",
    });
  }
}

/**
 * Runs the AI executor against a stage that's PENDING or REJECTED. The stage is moved to the
 * observable AI_DRAFTING state before the executor call (a real network request when a model
 * provider is configured) and out of it after — deliberately outside any DB transaction while
 * the call is in flight, see design.md in openspec/changes/real-ai-stage-drafting for why. The
 * write below re-checks the stage's status so a concurrent approval/rejection during the call
 * can't be silently overwritten. If the stage's configuration doesn't require approval, it
 * completes automatically and the pipeline advances as if a human had approved it.
 */
export async function draftStage(ctx: AuthContext, stageId: string) {
  const stage = await db.stage.findUniqueOrThrow({
    where: { id: stageId },
    include: { pipeline: { include: { workItem: { include: { project: true } }, stages: true } } },
  });
  requireClientRole(ctx, stage.pipeline.workItem.project.clientId, WRITE_ROLES);

  if (stage.status !== "PENDING" && stage.status !== "REJECTED") {
    throw new Error(`Stage is ${stage.status}; only PENDING or REJECTED stages can be drafted.`);
  }

  await db.stage.update({
    where: { id: stage.id },
    data: { status: "AI_DRAFTING", startedAt: stage.startedAt ?? new Date() },
  });

  const previousStage = stage.pipeline.stages
    .filter((s) => s.type !== stage.type)
    .find((s) => s.status === "DONE" || s.status === "APPROVED");

  let result;
  try {
    result = await getAgentExecutor().executeStage(stage.type, {
      workItemTitle: stage.pipeline.workItem.title,
      workItemDescription: stage.pipeline.workItem.description ?? "",
      workItemSource: stage.pipeline.workItem.source,
      workItemExternalId: stage.pipeline.workItem.externalId,
      previousStageContent: previousStage?.content ?? undefined,
    });
  } catch (err) {
    // Don't leave the stage stuck in AI_DRAFTING if the executor call fails — only revert if
    // it's still AI_DRAFTING (a concurrent approval/rejection may have already moved it on).
    await db.stage.updateMany({
      where: { id: stage.id, status: "AI_DRAFTING" },
      data: { status: stage.status },
    });
    throw err;
  }

  return db.$transaction(async (tx) => {
    const current = await tx.stage.findUniqueOrThrow({ where: { id: stage.id } });
    if (current.status !== "AI_DRAFTING") {
      throw new Error(`Stage changed to ${current.status} while drafting; discarding this draft.`);
    }

    const requiresApproval = getStageConfig(stage.type).requiresApproval;
    const updated = await tx.stage.update({
      where: { id: stage.id },
      data: {
        status: requiresApproval ? "PENDING_APPROVAL" : "DONE",
        content: result.content,
        aiModel: result.aiModel,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        costUsd: result.costUsd,
        completedAt: requiresApproval ? undefined : new Date(),
      },
    });

    if (stage.pipeline.status === "BLOCKED") {
      await tx.pipeline.update({ where: { id: stage.pipeline.id }, data: { status: "ACTIVE" } });
    }

    await recordAuditEvent(tx, {
      pipelineId: stage.pipeline.id,
      stageId: stage.id,
      actor: "AI",
      actorName: result.aiModel,
      action: `AI drafted ${getStageConfig(stage.type).label}`,
      detail: {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        costUsd: result.costUsd,
      },
    });

    if (!requiresApproval) {
      await recordAuditEvent(tx, {
        pipelineId: stage.pipeline.id,
        stageId: stage.id,
        actor: "SYSTEM",
        action: `${getStageConfig(stage.type).label} completed automatically (no approval required)`,
      });
      await advancePipelinePastStage(tx, stage.pipeline.id, stage.type);
    }

    return updated;
  });
}

/** Approves a stage's gate and advances the pipeline to the next stage (or completes it). Approver identity comes from ctx, never a client-supplied name. */
export async function approveStage(ctx: AuthContext, stageId: string, comment?: string) {
  return db.$transaction(async (tx) => {
    const stage = await tx.stage.findUniqueOrThrow({
      where: { id: stageId },
      include: { pipeline: { include: { workItem: { include: { project: true } } } } },
    });
    requireClientRole(ctx, stage.pipeline.workItem.project.clientId, WRITE_ROLES);
    if (stage.status !== "PENDING_APPROVAL") {
      throw new Error(`Stage is ${stage.status}; only PENDING_APPROVAL stages can be approved.`);
    }

    await tx.approval.create({
      data: { stageId: stage.id, decision: "APPROVED", approverId: ctx.userId, approverName: ctx.displayName, comment },
    });
    await tx.stage.update({ where: { id: stage.id }, data: { status: "DONE", completedAt: new Date() } });
    await recordAuditEvent(tx, {
      pipelineId: stage.pipeline.id,
      stageId: stage.id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} approved the ${getStageConfig(stage.type).label} gate`,
      detail: comment ? { comment } : undefined,
    });

    await advancePipelinePastStage(tx, stage.pipeline.id, stage.type);

    return tx.pipeline.findUniqueOrThrow({ where: { id: stage.pipeline.id }, include: { stages: true } });
  });
}

/** Rejects a stage's gate; the pipeline is blocked until the stage is redrafted via draftStage. Rejecter identity comes from ctx, never a client-supplied name. */
export async function rejectStage(ctx: AuthContext, stageId: string, comment?: string) {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const stage = await tx.stage.findUniqueOrThrow({
      where: { id: stageId },
      include: { pipeline: { include: { workItem: { include: { project: true } } } } },
    });
    requireClientRole(ctx, stage.pipeline.workItem.project.clientId, WRITE_ROLES);
    if (stage.status !== "PENDING_APPROVAL") {
      throw new Error(`Stage is ${stage.status}; only PENDING_APPROVAL stages can be rejected.`);
    }

    await tx.approval.create({
      data: { stageId: stage.id, decision: "REJECTED", approverId: ctx.userId, approverName: ctx.displayName, comment },
    });
    await tx.stage.update({ where: { id: stage.id }, data: { status: "REJECTED" } });
    await tx.pipeline.update({ where: { id: stage.pipeline.id }, data: { status: "BLOCKED" } });
    await recordAuditEvent(tx, {
      pipelineId: stage.pipeline.id,
      stageId: stage.id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} rejected the ${getStageConfig(stage.type).label} gate`,
      detail: comment ? { comment } : undefined,
    });

    return tx.stage.findUniqueOrThrow({ where: { id: stage.id } });
  });
}
