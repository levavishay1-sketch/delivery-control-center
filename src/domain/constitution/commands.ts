import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { enqueueJob } from "@/domain/job/commands";
import { checkBudget, completeAgentRun, failAgentRun } from "@/domain/agent/commands";
import { NotFoundError, ConflictError, BudgetExceededError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import type { Constitution } from "@/generated/prisma/client";

/**
 * Starts drafting a project's Constitution: transitions/creates the
 * Constitution row to AI_DRAFTING and enqueues a DRAFT_CONSTITUTION job for
 * the worker in the same transaction (see design.md Decision 4a) — so a
 * crash between the two can never happen; either both commit or neither
 * does, and a stage/Constitution never gets stuck in a drafting state with
 * no job to move it out. Returns as soon as the job is queued, not once
 * drafted.
 *
 * Draft-vs-new-version policy: no existing Constitution -> version 1;
 * latest is DRAFT (never submitted) -> reused in place; latest is
 * REJECTED or APPROVED -> a new version (never overwritten in place, so
 * rejected content stays retrievable and an approved version can still be
 * superseded later without losing history — getApprovedConstitution just
 * picks the newest APPROVED version, so an older APPROVED row doesn't need
 * to be actively un-approved); latest is PENDING_APPROVAL/AI_DRAFTING ->
 * refused, to avoid version churn while a submission is already in flight
 * or under review.
 */
export async function draftConstitution(ctx: AuthContext, projectId: string): Promise<Constitution> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, WRITE_ROLES);

  const budgetCheck = await checkBudget(project.clientId, projectId);
  if (!budgetCheck.allowed) {
    throw new BudgetExceededError(
      `AI drafting is blocked: the ${budgetCheck.scope} AI budget of $${budgetCheck.budgetUsd} has been reached ($${budgetCheck.accruedUsd} spent). Ask a manager to approve continuing.`,
      budgetCheck.scope!,
      project.clientId,
      projectId
    );
  }

  const constitution = await db.$transaction(async (tx) => {
    const latest = await tx.constitution.findFirst({ where: { projectId }, orderBy: { version: "desc" } });

    let result: Constitution;
    if (!latest) {
      result = await tx.constitution.create({ data: { projectId, version: 1, status: "AI_DRAFTING" } });
    } else if (latest.status === "DRAFT") {
      result = await tx.constitution.update({ where: { id: latest.id }, data: { status: "AI_DRAFTING" } });
    } else if (latest.status === "REJECTED" || latest.status === "APPROVED") {
      result = await tx.constitution.create({
        data: { projectId, version: latest.version + 1, status: "AI_DRAFTING" },
      });
    } else {
      throw new ConflictError(
        `Constitution is ${latest.status}; drafting is refused while a version is already in flight or awaiting a decision.`
      );
    }

    await recordAuditEvent(tx, {
      projectId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `Requested Constitution v${result.version} draft`,
    });

    // Date.now() suffix: the DRAFT-reused-in-place path drafts the same row more than once
    // (e.g. after a reverted failure), and a stable key would collide with that row's prior
    // job, returning stale state instead of enqueueing fresh work.
    await enqueueJob("DRAFT_CONSTITUTION", { constitutionId: result.id }, `constitution-${result.id}-${Date.now()}`, tx);

    return result;
  });

  return constitution;
}

/** Worker-side: loads what's needed to run the AI executor for a queued DRAFT_CONSTITUTION job. */
export async function getConstitutionForDrafting(constitutionId: string) {
  return db.constitution.findUniqueOrThrow({ where: { id: constitutionId }, include: { project: true } });
}

export interface ConstitutionDraftResult {
  content: string;
  aiModel: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

/**
 * Worker-side completion: writes the AI executor's result and moves the
 * Constitution to PENDING_APPROVAL. Re-checks the row is still AI_DRAFTING
 * (mirrors draftStage's own re-check) in case it changed concurrently.
 *
 * `runId` (Slice 3) is the AgentRun tracking this drafting attempt-cycle, if the caller started
 * one. When present, it's marked SUCCEEDED in this same transaction and linked as agentRunId
 * alongside (not instead of — design.md Decision 2) the aiModel/token/cost columns.
 */
export async function completeConstitutionDraft(
  constitutionId: string,
  result: ConstitutionDraftResult,
  runId?: string
): Promise<Constitution> {
  return db.$transaction(async (tx) => {
    const current = await tx.constitution.findUniqueOrThrow({ where: { id: constitutionId } });
    if (current.status !== "AI_DRAFTING") {
      throw new Error(`Constitution changed to ${current.status} while drafting; discarding this draft.`);
    }

    if (runId) {
      await completeAgentRun(
        runId,
        { promptTokens: result.promptTokens, completionTokens: result.completionTokens, costUsd: result.costUsd },
        tx
      );
    }

    const updated = await tx.constitution.update({
      where: { id: constitutionId },
      data: {
        status: "PENDING_APPROVAL",
        content: result.content,
        aiModel: result.aiModel,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        costUsd: result.costUsd,
        agentRunId: runId,
      },
    });

    await recordAuditEvent(tx, {
      projectId: current.projectId,
      actor: "AI",
      actorName: result.aiModel,
      action: `AI drafted Constitution v${current.version}`,
      detail: { promptTokens: result.promptTokens, completionTokens: result.completionTokens, costUsd: result.costUsd },
    });

    return updated;
  });
}

/**
 * Worker-side failure handling, called only once the job's retries are
 * exhausted (not on every individual attempt — a mid-retry job should not
 * make the Constitution look freely re-draftable while it's still retrying
 * in the background). Reverts the same row back to DRAFT — reusing that
 * status rather than inventing a new one, the same choice Task Group 5
 * makes for Stage by reusing REJECTED. A no-op if the row already moved on
 * (e.g. a concurrent change) by the time this runs.
 *
 * `jobId` (Slice 3), when given, finalizes that job's AgentRun as FAILED in this same
 * transaction — the exhaustion counterpart to completeConstitutionDraft's SUCCEEDED write.
 */
export async function revertConstitutionDraftFailure(constitutionId: string, error: string, jobId?: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const updated = await tx.constitution.updateMany({
      where: { id: constitutionId, status: "AI_DRAFTING" },
      data: { status: "DRAFT" },
    });
    if (updated.count === 0) return;

    if (jobId) {
      const run = await tx.agentRun.findFirst({ where: { jobId } });
      if (run) {
        await failAgentRun(run.id, { retryCount: run.retryCount, error, exhausted: true }, tx);
      }
    }

    const constitution = await tx.constitution.findUniqueOrThrow({ where: { id: constitutionId } });
    await recordAuditEvent(tx, {
      projectId: constitution.projectId,
      actor: "SYSTEM",
      action: `Constitution v${constitution.version} drafting failed after exhausting retries: ${error}`,
    });
  });
}

/** Approves a PENDING_APPROVAL Constitution version. No Approval row (that model is Stage-scoped) — the audit event is the record. */
export async function approveConstitution(ctx: AuthContext, constitutionId: string): Promise<Constitution> {
  return db.$transaction(async (tx) => {
    const constitution = await tx.constitution.findUniqueOrThrow({
      where: { id: constitutionId },
      include: { project: true },
    });
    requireClientRole(ctx, constitution.project.clientId, WRITE_ROLES);
    if (constitution.status !== "PENDING_APPROVAL") {
      throw new ConflictError(`Constitution is ${constitution.status}; only PENDING_APPROVAL versions can be approved.`);
    }

    const updated = await tx.constitution.update({
      where: { id: constitutionId },
      data: { status: "APPROVED", approvedAt: new Date() },
    });

    await recordAuditEvent(tx, {
      projectId: constitution.projectId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `Approved Constitution v${constitution.version}`,
    });

    return updated;
  });
}

/** Rejects a PENDING_APPROVAL Constitution version; a redraft creates a new version rather than reusing this one. */
export async function rejectConstitution(ctx: AuthContext, constitutionId: string, comment?: string): Promise<Constitution> {
  return db.$transaction(async (tx) => {
    const constitution = await tx.constitution.findUniqueOrThrow({
      where: { id: constitutionId },
      include: { project: true },
    });
    requireClientRole(ctx, constitution.project.clientId, WRITE_ROLES);
    if (constitution.status !== "PENDING_APPROVAL") {
      throw new ConflictError(`Constitution is ${constitution.status}; only PENDING_APPROVAL versions can be rejected.`);
    }

    const updated = await tx.constitution.update({
      where: { id: constitutionId },
      data: { status: "REJECTED" },
    });

    await recordAuditEvent(tx, {
      projectId: constitution.projectId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `Rejected Constitution v${constitution.version}`,
      detail: comment ? { comment } : undefined,
    });

    return updated;
  });
}
