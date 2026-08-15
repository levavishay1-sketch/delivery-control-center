import { db } from "@/lib/db";
import { getNextStageTypeInSequence, getStageConfig, getStageConfigOrFallback, loadWorkflow } from "@/lib/config";
import { recordAuditEvent } from "@/lib/audit";
import { getApprovedConstitution } from "@/domain/constitution/queries";
import { enqueueJob } from "@/domain/job/commands";
import type { FindingSeverity, Prisma, Role, StageType } from "@/generated/prisma/client";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import { ConflictError, ValidationError } from "@/domain/shared/errors";

/**
 * Resolves a stage type's approverRoles without ever throwing — getStageConfig throws for a
 * type retired from the live config (e.g. CONSTITUTION on a pre-Slice-2 pipeline; see
 * getStageConfigOrFallback's own doc comment on why that fallback isn't used for gating).
 * approveStage/rejectStage need authorization to be checkable before anything else, including
 * before a live-config lookup that could fail for an old stage type — falling back to the
 * pre-Task-Group-8 uniform WRITE_ROLES check here preserves that for stages predating
 * approverRoles entirely, rather than crashing the request.
 */
function getApproverRolesSafe(type: StageType): Role[] {
  try {
    return getStageConfig(type).approverRoles ?? WRITE_ROLES;
  } catch {
    return WRITE_ROLES;
  }
}

/**
 * Explicitly starts a Pipeline for a work item: requires the project to
 * have an APPROVED Constitution (drafted and approved separately — see
 * src/domain/constitution/commands.ts) and the work item to have no
 * pipeline yet (the DB's @unique on workItemId enforces this too, but this
 * gives a clear domain error instead of a raw constraint violation).
 * Snapshots stageSequence from the live config and constitutionVersion
 * from the approved Constitution — see design.md Decisions 3 and 4/7.
 */
export async function startPipeline(ctx: AuthContext, workItemId: string) {
  const workItem = await db.workItem.findUniqueOrThrow({
    where: { id: workItemId },
    include: { project: true, pipeline: true },
  });
  requireClientRole(ctx, workItem.project.clientId, WRITE_ROLES);

  if (workItem.pipeline) {
    throw new ConflictError("This work item already has a pipeline.");
  }

  const constitution = await getApprovedConstitution(workItem.projectId);
  if (!constitution) {
    throw new ValidationError(
      "This project has no approved Constitution yet. Draft and approve one before starting a pipeline."
    );
  }

  const stageSequence = loadWorkflow().map((s) => s.type);
  const firstStage = stageSequence[0];

  return db.$transaction(async (tx) => {
    const pipeline = await tx.pipeline.create({
      data: {
        workItemId: workItem.id,
        currentStage: firstStage,
        stageSequence,
        constitutionVersion: constitution.version,
        stages: { create: { type: firstStage } },
      },
      include: { stages: true },
    });

    await recordAuditEvent(tx, {
      pipelineId: pipeline.id,
      workItemId: workItem.id,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} started the pipeline for "${workItem.title}"`,
      detail: { firstStage, constitutionVersion: constitution.version, stageSequence },
    });

    return pipeline;
  });
}

/**
 * Advances the pipeline past a just-completed stage: creates the next configured stage, or
 * marks the pipeline COMPLETED if there isn't one. Shared by approveStage and draftStage's
 * requiresApproval:false auto-complete path — both reach this the same way a human approval does.
 *
 * No-ops when completedStageType isn't the pipeline's actual currentStage: this happens when a
 * stage a Critical Analyze finding names gets redrafted and re-approved after the pipeline has
 * already moved on to ANALYZE (see design.md Decision 8 / Task Group 7.3) — that stage's own
 * status still updates, but there is no "next" stage to create (one already exists) and the
 * pipeline's frontier must not move backward.
 */
async function advancePipelinePastStage(
  tx: Prisma.TransactionClient,
  pipelineId: string,
  stageSequence: StageType[],
  currentStage: StageType,
  completedStageType: StageType
) {
  if (completedStageType !== currentStage) return;

  const nextType = getNextStageTypeInSequence(stageSequence, completedStageType);
  if (nextType) {
    await tx.stage.create({ data: { pipelineId, type: nextType } });
    await tx.pipeline.update({ where: { id: pipelineId }, data: { currentStage: nextType } });
    await recordAuditEvent(tx, {
      pipelineId,
      actor: "SYSTEM",
      action: `Pipeline advanced to ${getStageConfigOrFallback(nextType).label}`,
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
 * Moves a PENDING or REJECTED stage to AI_DRAFTING and enqueues a DRAFT_STAGE job for the
 * worker in the same transaction — so a crash between the two can never leave the stage
 * stuck in AI_DRAFTING with no job to move it out (see design.md Decisions 1/2 and Task
 * Group 5). Returns as soon as the job is queued, not once drafted; the worker performs the
 * actual executor call via getStageForDrafting/completeStageDraft/revertStageDraftFailure
 * below. (CLARIFY's AWAITING_CLARIFICATION branch is added in Task Group 6.)
 *
 * One additional entry point (Task Group 7.3): a DONE stage can also be redrafted if it's
 * currently named by an unresolved Critical Analyze finding — i.e. the pipeline's ANALYZE
 * stage is REJECTED (blocking) and one of its findings' relatedStageType is this stage's type.
 * This is how a human resolves the block (design.md Decision 8's "redraft the implicated
 * stage"). No separate "resolved" flag is needed: redrafting ANALYZE itself always replaces
 * its findings (see completeStageDraft), so once ANALYZE is clean again this condition no
 * longer matches on its own.
 */
export async function draftStage(ctx: AuthContext, stageId: string) {
  const stage = await db.stage.findUniqueOrThrow({
    where: { id: stageId },
    include: { pipeline: { include: { workItem: { include: { project: true } } } } },
  });
  requireClientRole(ctx, stage.pipeline.workItem.project.clientId, WRITE_ROLES);

  const flaggedByCriticalAnalyze =
    stage.status === "DONE" &&
    (await db.analysisFinding.findFirst({
      where: {
        relatedStageType: stage.type,
        severity: "CRITICAL",
        stage: { pipelineId: stage.pipelineId, type: "ANALYZE", status: "REJECTED" },
      },
    })) !== null;

  if (stage.status !== "PENDING" && stage.status !== "REJECTED" && !flaggedByCriticalAnalyze) {
    throw new Error(`Stage is ${stage.status}; only PENDING or REJECTED stages can be drafted.`);
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.stage.update({
      where: { id: stage.id },
      data: { status: "AI_DRAFTING", startedAt: stage.startedAt ?? new Date() },
    });

    // Date.now() suffix: a stage is redrafted many times across its life (PENDING/REJECTED ->
    // AI_DRAFTING, repeatedly) and a stable key would collide with a prior attempt's job.
    await enqueueJob("DRAFT_STAGE", { stageId: stage.id }, `draft-stage-${stage.id}-${Date.now()}`, tx);

    return updated;
  });
}

/**
 * Worker-side: loads what's needed to run the AI executor for a queued DRAFT_STAGE job.
 * clarifyQuestions is included so a CLARIFY redraft after answering can fold Q&A into context.
 * approvals (most recent first, one row) is included so a redraft after a human rejection can
 * fold the rejection comment into context — see Task Group 9.
 */
export async function getStageForDrafting(stageId: string) {
  return db.stage.findUniqueOrThrow({
    where: { id: stageId },
    include: {
      pipeline: { include: { workItem: { include: { project: true } }, stages: true } },
      clarifyQuestions: true,
      approvals: { orderBy: { decidedAt: "desc" }, take: 1 },
    },
  });
}

export interface StageDraftResult {
  content: string;
  aiModel: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  /** Present only for a CLARIFY draft that asked questions instead of producing content — see Task Group 6. */
  clarifyQuestions?: string[];
  /** Present only for an ANALYZE draft — always set (possibly empty) — see Task Group 7. */
  analysisFindings?: { severity: FindingSeverity; message: string; relatedStageType: StageType }[];
}

/**
 * Worker-side completion: writes the executor's result, records an append-only
 * StageVersion (design.md Decision 5) alongside Stage's own "latest" columns, and — if the
 * stage doesn't require approval — auto-advances the pipeline. Re-checks the stage is still
 * AI_DRAFTING first (a concurrent approval/rejection during the call can't be silently
 * overwritten), same as the old synchronous path did. A CLARIFY draft that asked questions
 * instead of drafting content takes a separate branch: no content, no StageVersion, no
 * auto-advance — the stage moves to AWAITING_CLARIFICATION until every question is answered
 * (src/domain/clarify/commands.ts), which is what actually resumes drafting. An ANALYZE draft
 * takes its own branch too: it always completes (read-only check, not a gate — design.md
 * Decision 8), but a Critical finding marks the stage REJECTED instead of DONE and skips
 * auto-advance, blocking the pipeline the same way a human rejection or an exhausted retry
 * does, until the flagged stage is redrafted and ANALYZE is drafted again clean.
 */
export async function completeStageDraft(stageId: string, result: StageDraftResult) {
  return db.$transaction(async (tx) => {
    const current = await tx.stage.findUniqueOrThrow({ where: { id: stageId }, include: { pipeline: true } });
    if (current.status !== "AI_DRAFTING") {
      throw new Error(`Stage changed to ${current.status} while drafting; discarding this draft.`);
    }

    if (result.clarifyQuestions?.length) {
      const updated = await tx.stage.update({
        where: { id: stageId },
        data: {
          status: "AWAITING_CLARIFICATION",
          aiModel: result.aiModel,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          costUsd: result.costUsd,
        },
      });
      await tx.clarifyQuestion.createMany({
        data: result.clarifyQuestions.map((question) => ({ stageId, question })),
      });
      await recordAuditEvent(tx, {
        pipelineId: current.pipeline.id,
        stageId,
        actor: "AI",
        actorName: result.aiModel,
        action: `AI asked ${result.clarifyQuestions.length} clarifying question(s) on ${getStageConfigOrFallback(current.type).label}`,
        detail: { questions: result.clarifyQuestions },
      });
      return updated;
    }

    if (result.analysisFindings) {
      const hasCritical = result.analysisFindings.some((f) => f.severity === "CRITICAL");
      const updated = await tx.stage.update({
        where: { id: stageId },
        data: {
          status: hasCritical ? "REJECTED" : "DONE",
          content: result.content,
          aiModel: result.aiModel,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          costUsd: result.costUsd,
          completedAt: hasCritical ? undefined : new Date(),
        },
      });

      // Only the latest ANALYZE run's findings count (design.md Decision 8) — replace, don't
      // accumulate, so a clean redraft after fixing a flagged stage clears the old ones.
      await tx.analysisFinding.deleteMany({ where: { stageId } });
      if (result.analysisFindings.length > 0) {
        await tx.analysisFinding.createMany({
          data: result.analysisFindings.map((f) => ({
            stageId,
            severity: f.severity,
            message: f.message,
            relatedStageType: f.relatedStageType,
          })),
        });
      }

      const priorVersionCount = await tx.stageVersion.count({ where: { stageId } });
      await tx.stageVersion.create({
        data: {
          stageId,
          versionNumber: priorVersionCount + 1,
          content: result.content,
          aiModel: result.aiModel,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          costUsd: result.costUsd,
          createdAsResultOf: priorVersionCount === 0 ? "DRAFT" : "REDRAFT",
        },
      });

      await recordAuditEvent(tx, {
        pipelineId: current.pipeline.id,
        stageId,
        actor: "AI",
        actorName: result.aiModel,
        action: `AI analyzed prior stages: ${result.analysisFindings.length} finding(s)${
          hasCritical ? " — Critical, blocking advancement" : ""
        }`,
        detail: { findings: result.analysisFindings },
      });

      if (hasCritical) {
        await tx.pipeline.update({ where: { id: current.pipeline.id }, data: { status: "BLOCKED" } });
      } else {
        if (current.pipeline.status === "BLOCKED") {
          await tx.pipeline.update({ where: { id: current.pipeline.id }, data: { status: "ACTIVE" } });
        }
        await advancePipelinePastStage(
          tx,
          current.pipeline.id,
          current.pipeline.stageSequence,
          current.pipeline.currentStage,
          current.type
        );
      }

      return updated;
    }

    const requiresApproval = getStageConfig(current.type).requiresApproval;
    const updated = await tx.stage.update({
      where: { id: stageId },
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

    const priorVersionCount = await tx.stageVersion.count({ where: { stageId } });
    await tx.stageVersion.create({
      data: {
        stageId,
        versionNumber: priorVersionCount + 1,
        content: result.content,
        aiModel: result.aiModel,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        costUsd: result.costUsd,
        createdAsResultOf: priorVersionCount === 0 ? "DRAFT" : "REDRAFT",
      },
    });

    if (current.pipeline.status === "BLOCKED") {
      await tx.pipeline.update({ where: { id: current.pipeline.id }, data: { status: "ACTIVE" } });
    }

    await recordAuditEvent(tx, {
      pipelineId: current.pipeline.id,
      stageId,
      actor: "AI",
      actorName: result.aiModel,
      action: `AI drafted ${getStageConfigOrFallback(current.type).label}`,
      detail: {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        costUsd: result.costUsd,
      },
    });

    if (!requiresApproval) {
      await recordAuditEvent(tx, {
        pipelineId: current.pipeline.id,
        stageId,
        actor: "SYSTEM",
        action: `${getStageConfigOrFallback(current.type).label} completed automatically (no approval required)`,
      });
      await advancePipelinePastStage(
        tx,
        current.pipeline.id,
        current.pipeline.stageSequence,
        current.pipeline.currentStage,
        current.type
      );
    }

    return updated;
  });
}

/**
 * Worker-side failure handling, called only once the job's retries are exhausted (not on
 * every attempt — a mid-retry job shouldn't make the stage look freely re-draftable while
 * still retrying in the background; same choice as constitution/commands.ts). Reuses
 * REJECTED rather than inventing a new status (per tasks.md 5.3) — a human sees it exactly
 * as they'd see any other rejected stage and redrafts it the same way — and blocks the
 * pipeline the same way a human rejection does. A no-op if the stage already moved on.
 */
export async function revertStageDraftFailure(stageId: string, error: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const reverted = await tx.stage.updateMany({
      where: { id: stageId, status: "AI_DRAFTING" },
      data: { status: "REJECTED" },
    });
    if (reverted.count === 0) return;

    const stage = await tx.stage.findUniqueOrThrow({ where: { id: stageId } });
    await tx.pipeline.update({ where: { id: stage.pipelineId }, data: { status: "BLOCKED" } });
    await recordAuditEvent(tx, {
      pipelineId: stage.pipelineId,
      stageId,
      actor: "SYSTEM",
      action: `${getStageConfigOrFallback(stage.type).label} drafting failed after exhausting retries: ${error}`,
    });
  });
}

/**
 * Approves a stage's gate and advances the pipeline to the next stage (or completes it).
 * Approver identity comes from ctx, never a client-supplied name. Gated by the stage type's own
 * approverRoles (design.md Decision 6), not the uniform WRITE_ROLES check every stage used
 * before Task Group 8 — a role with general write access can still be refused on a specific
 * stage type its list doesn't include.
 */
export async function approveStage(ctx: AuthContext, stageId: string, comment?: string) {
  return db.$transaction(async (tx) => {
    const stage = await tx.stage.findUniqueOrThrow({
      where: { id: stageId },
      include: { pipeline: { include: { workItem: { include: { project: true } } } } },
    });
    requireClientRole(ctx, stage.pipeline.workItem.project.clientId, getApproverRolesSafe(stage.type));
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
      action: `${ctx.displayName} approved the ${getStageConfigOrFallback(stage.type).label} gate`,
      detail: comment ? { comment } : undefined,
    });

    await advancePipelinePastStage(tx, stage.pipeline.id, stage.pipeline.stageSequence, stage.pipeline.currentStage, stage.type);

    return tx.pipeline.findUniqueOrThrow({ where: { id: stage.pipeline.id }, include: { stages: true } });
  });
}

/**
 * Rejects a stage's gate; the pipeline is blocked until the stage is redrafted via draftStage.
 * Rejecter identity comes from ctx, never a client-supplied name. Gated by the same
 * approverRoles as approveStage — rejecting is part of the same gate decision as approving.
 */
export async function rejectStage(ctx: AuthContext, stageId: string, comment?: string) {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const stage = await tx.stage.findUniqueOrThrow({
      where: { id: stageId },
      include: { pipeline: { include: { workItem: { include: { project: true } } } } },
    });
    requireClientRole(ctx, stage.pipeline.workItem.project.clientId, getApproverRolesSafe(stage.type));
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
      action: `${ctx.displayName} rejected the ${getStageConfigOrFallback(stage.type).label} gate`,
      detail: comment ? { comment } : undefined,
    });

    return tx.stage.findUniqueOrThrow({ where: { id: stage.id } });
  });
}
