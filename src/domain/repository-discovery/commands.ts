import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { enqueueJob } from "@/domain/job/commands";
import { checkClientBudget, completeAgentRun, failAgentRun } from "@/domain/agent/commands";
import { BudgetExceededError, NotFoundError } from "@/domain/shared/errors";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import type { RepositoryDiscovery } from "@/generated/prisma/client";
import type { RepositoryDiscoveryFindings } from "@/lib/agents/types";

/**
 * Triggers a new Discovery run for a repository: creates the next version (design.md's
 * "RepositoryDiscovery is a new top-level model" decision — never overwritten in place) and
 * enqueues a RUN_REPOSITORY_DISCOVERY job in the same transaction, mirroring
 * draftConstitution's crash-safety pattern. Gated the same way every other AI-cost-incurring
 * action in this codebase is: write-capable role on the owning client, and a budget check —
 * here `checkClientBudget` (Slice 14), since Discovery has no Project tier to fall through.
 */
export async function runRepositoryDiscovery(ctx: AuthContext, repositoryId: string): Promise<RepositoryDiscovery> {
  const repository = await db.repository.findUnique({ where: { id: repositoryId } });
  if (!repository) throw new NotFoundError("Repository not found");
  requireClientRole(ctx, repository.clientId, WRITE_ROLES);

  const budgetCheck = await checkClientBudget(repository.clientId);
  if (!budgetCheck.allowed) {
    throw new BudgetExceededError(
      `Repository Discovery is blocked: the ${budgetCheck.scope} AI budget of $${budgetCheck.budgetUsd} has been reached ($${budgetCheck.accruedUsd} spent). Ask a manager to approve continuing.`,
      budgetCheck.scope!,
      repository.clientId,
      undefined,
      budgetCheck.scope === "organization" ? budgetCheck.scopeId : null
    );
  }

  return db.$transaction(async (tx) => {
    const latest = await tx.repositoryDiscovery.findFirst({ where: { repositoryId }, orderBy: { version: "desc" } });
    const version = (latest?.version ?? 0) + 1;

    const discovery = await tx.repositoryDiscovery.create({
      data: { repositoryId, version, status: "RUNNING", triggeredByUserId: ctx.userId },
    });

    await recordAuditEvent(tx, {
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} started Discovery v${version} for ${repository.owner}/${repository.name}`,
      detail: { repositoryId, discoveryId: discovery.id },
    });

    await enqueueJob("RUN_REPOSITORY_DISCOVERY", { repositoryDiscoveryId: discovery.id }, `repository-discovery-${discovery.id}`, tx);

    return discovery;
  });
}

/** Worker-side: loads what's needed to run the AI executor for a queued RUN_REPOSITORY_DISCOVERY job. */
export async function getRepositoryDiscoveryForRun(discoveryId: string) {
  return db.repositoryDiscovery.findUniqueOrThrow({
    where: { id: discoveryId },
    include: { repository: { include: { connector: true } } },
  });
}

export interface RepositoryDiscoveryRunResult {
  findings: RepositoryDiscoveryFindings;
  aiModel: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

/**
 * Worker-side completion: writes the AI executor's validated findings and moves the run to
 * SUCCEEDED. Re-checks the row is still RUNNING (mirrors completeConstitutionDraft's own
 * re-check) in case it changed concurrently.
 */
export async function completeRepositoryDiscovery(
  discoveryId: string,
  result: RepositoryDiscoveryRunResult,
  runId: string
): Promise<RepositoryDiscovery> {
  return db.$transaction(async (tx) => {
    const current = await tx.repositoryDiscovery.findUniqueOrThrow({
      where: { id: discoveryId },
      include: { repository: true },
    });
    if (current.status !== "RUNNING") {
      throw new Error(`RepositoryDiscovery changed to ${current.status} while running; discarding this result.`);
    }

    await completeAgentRun(
      runId,
      { promptTokens: result.promptTokens, completionTokens: result.completionTokens, costUsd: result.costUsd },
      tx
    );

    const updated = await tx.repositoryDiscovery.update({
      where: { id: discoveryId },
      data: {
        status: "SUCCEEDED",
        findings: result.findings,
        aiModel: result.aiModel,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        costUsd: result.costUsd,
        agentRunId: runId,
        completedAt: new Date(),
      },
    });

    await recordAuditEvent(tx, {
      actor: "AI",
      actorName: result.aiModel,
      action: `AI completed Discovery v${current.version} for ${current.repository.owner}/${current.repository.name}`,
      detail: { repositoryId: current.repositoryId, discoveryId, promptTokens: result.promptTokens, completionTokens: result.completionTokens, costUsd: result.costUsd },
    });

    return updated;
  });
}

/**
 * Worker-side failure handling, called only once the job's retries are exhausted — mirrors
 * revertConstitutionDraftFailure's shape exactly, marking both the RepositoryDiscovery and its
 * AgentRun FAILED in one transaction. A no-op if the row already moved on.
 */
export async function revertRepositoryDiscoveryFailure(discoveryId: string, error: string, jobId?: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const updated = await tx.repositoryDiscovery.updateMany({
      where: { id: discoveryId, status: "RUNNING" },
      data: { status: "FAILED", lastError: error, completedAt: new Date() },
    });
    if (updated.count === 0) return;

    if (jobId) {
      const run = await tx.agentRun.findFirst({ where: { jobId } });
      if (run) {
        await failAgentRun(run.id, { retryCount: run.retryCount, error, exhausted: true }, tx);
      }
    }

    const discovery = await tx.repositoryDiscovery.findUniqueOrThrow({
      where: { id: discoveryId },
      include: { repository: true },
    });
    await recordAuditEvent(tx, {
      actor: "SYSTEM",
      action: `Discovery v${discovery.version} for ${discovery.repository.owner}/${discovery.repository.name} failed after exhausting retries: ${error}`,
      detail: { repositoryId: discovery.repositoryId, discoveryId },
    });
  });
}
