import { db } from "@/lib/db";
import { loadAgents } from "@/lib/config";
import { getAgentById, getClientAiCost, getDefaultAgent, getProjectAiCost } from "@/domain/agent/queries";
import { recordAuditEvent } from "@/lib/audit";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, WRITE_ROLES } from "@/domain/shared/authz";
import { ValidationError } from "@/domain/shared/errors";
import { Prisma, type StageType } from "@/generated/prisma/client";

type DbClient = typeof db | Prisma.TransactionClient;

/**
 * Upserts every config/workflow.yaml `agents:` entry into the Agent table by
 * name — config is authoritative (design.md Decision 3's "no new config
 * file"); the DB row exists only so AgentRun/Pipeline.agentRouting can FK to
 * a stable id. Resets every row's isDefault to false first, then reapplies
 * from config in the same transaction, so a config change that moves
 * `default: true` to a different entry never leaves two rows marked default
 * (loadAgents() already validated the config itself names exactly one).
 */
export async function syncAgentRegistry() {
  const configured = loadAgents();
  return db.$transaction(async (tx) => {
    await tx.agent.updateMany({ data: { isDefault: false } });
    for (const agent of configured) {
      await tx.agent.upsert({
        where: { name: agent.name },
        create: { name: agent.name, provider: agent.provider, model: agent.model, isDefault: agent.isDefault },
        update: { provider: agent.provider, model: agent.model, isDefault: agent.isDefault },
      });
    }
    return tx.agent.findMany({ orderBy: { name: "asc" } });
  });
}

/**
 * Resolves the registry's current default Agent id, syncing config into the
 * Agent table first only if no default row exists yet (e.g. a fresh
 * environment where startPipeline has never run) — the common case just
 * reads the already-synced row.
 */
export async function resolveDefaultAgentId(): Promise<string> {
  const existing = await getDefaultAgent();
  if (existing) return existing.id;
  const synced = await syncAgentRegistry();
  const fallback = synced.find((a) => a.isDefault);
  if (!fallback) throw new Error("config/workflow.yaml's agents: list must mark exactly one default agent.");
  return fallback.id;
}

/**
 * Resolves which Agent a stage draft should run through: the pipeline's own
 * snapshotted agentRouting entry for that stage type (design.md Decision 3)
 * if it still names a real Agent row, else the registry's current default —
 * covering pre-Slice-3 pipelines, which snapshotted no routing at all.
 */
export async function resolveStageAgentId(agentRouting: unknown, stageType: StageType): Promise<string> {
  const routing = (agentRouting ?? {}) as Record<string, string>;
  const routedId = routing[stageType];
  if (routedId) {
    const agent = await getAgentById(routedId);
    if (agent) return agent.id;
  }
  return resolveDefaultAgentId();
}

/**
 * Creates the AgentRun for a drafting job's attempt-cycle when first
 * claimed. Idempotent per jobId: a retry re-invokes the same handler, which
 * calls this again, and must reuse the same run row rather than create a
 * second one (design.md Decision 1 — one AgentRun per Job, not per attempt).
 */
export async function startAgentRun(agentId: string, jobId: string) {
  const existing = await db.agentRun.findFirst({ where: { jobId } });
  if (existing) return existing;
  return db.agentRun.create({ data: { agentId, jobId, status: "RUNNING" } });
}

/** Marks an AgentRun SUCCEEDED with its final token/cost totals. Accepts a transaction client so it can be wired into the same transaction as completeStageDraft/completeConstitutionDraft (design.md Decision 2). */
export async function completeAgentRun(
  runId: string,
  result: { promptTokens: number; completionTokens: number; costUsd: number },
  client: DbClient = db
) {
  return client.agentRun.update({
    where: { id: runId },
    data: {
      status: "SUCCEEDED",
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      costUsd: result.costUsd,
      completedAt: new Date(),
    },
  });
}

/**
 * Records a failed attempt against an existing AgentRun. `exhausted: false`
 * (a Job reschedule with retries remaining) only updates retryCount/lastError,
 * keeping the run RUNNING — the same attempt-cycle continues. `exhausted:
 * true` (the Job's final failure) sets FAILED and completedAt. Accepts a
 * transaction client so the exhaustion case can be wired into
 * revertStageDraftFailure/revertConstitutionDraftFailure's own transaction.
 */
export async function failAgentRun(
  runId: string,
  { retryCount, error, exhausted }: { retryCount: number; error: string; exhausted: boolean },
  client: DbClient = db
) {
  return client.agentRun.update({
    where: { id: runId },
    data: exhausted
      ? { status: "FAILED", retryCount, lastError: error, completedAt: new Date() }
      : { retryCount, lastError: error },
  });
}

export interface BudgetCheckResult {
  allowed: boolean;
  /** Which threshold was checked — null when the scope has no budget configured at all (always allowed). */
  scope: "client" | "project" | null;
  budgetUsd: Prisma.Decimal | null;
  accruedUsd: Prisma.Decimal | null;
}

/**
 * Atomically claims one unconsumed BudgetOverride for the given scope, the same claim pattern
 * Job.claimJobs already uses (UPDATE ... WHERE consumed = false ... RETURNING) — so two
 * concurrent requests past budget can never both consume the same grant. `column` is one of two
 * fixed literals this module controls, never user input.
 */
async function claimBudgetOverride(column: "clientId" | "projectId", scopeId: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "BudgetOverride"
    SET consumed = true, "consumedAt" = now()
    WHERE id = (
      SELECT id FROM "BudgetOverride"
      WHERE ${Prisma.raw(`"${column}"`)} = ${scopeId} AND consumed = false
      ORDER BY "approvedAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  return rows.length > 0;
}

/**
 * Resolves the effective budget for a scope — the project's aiBudgetUsd if set, else the
 * client's, else unbounded (design.md Decision 4: project overrides client, not the stricter of
 * the two) — and checks accrued AgentRun cost against it. If exceeded, atomically consumes a
 * matching unconsumed BudgetOverride if one exists; otherwise refuses. A scope with no budget
 * configured at either level is never blocked.
 */
export async function checkBudget(clientId: string, projectId: string): Promise<BudgetCheckResult> {
  const [client, project] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: clientId } }),
    db.project.findUniqueOrThrow({ where: { id: projectId } }),
  ]);

  const scope: "client" | "project" | null =
    project.aiBudgetUsd !== null ? "project" : client.aiBudgetUsd !== null ? "client" : null;
  if (!scope) {
    return { allowed: true, scope: null, budgetUsd: null, accruedUsd: null };
  }

  const budgetUsd = scope === "project" ? project.aiBudgetUsd! : client.aiBudgetUsd!;
  const accruedUsd = scope === "project" ? await getProjectAiCost(projectId) : await getClientAiCost(clientId);

  if (accruedUsd.lessThan(budgetUsd)) {
    return { allowed: true, scope, budgetUsd, accruedUsd };
  }

  const consumed = await claimBudgetOverride(
    scope === "project" ? "projectId" : "clientId",
    scope === "project" ? projectId : clientId
  );
  return { allowed: consumed, scope, budgetUsd, accruedUsd };
}

/**
 * Grants a single-use approval to draft past an exceeded budget (design.md Decision 5): a
 * WRITE_ROLES-gated, audited action — not a config toggle that silently raises the limit.
 * Exactly one of clientId/projectId must be set, mirroring checkBudget's own scope precedence.
 */
export async function approveBudgetOverride(
  ctx: AuthContext,
  scope: { clientId?: string; projectId?: string }
) {
  if ((scope.clientId ? 1 : 0) + (scope.projectId ? 1 : 0) !== 1) {
    throw new ValidationError("approveBudgetOverride requires exactly one of clientId or projectId.");
  }

  const clientIdForAuth = scope.projectId
    ? (await db.project.findUniqueOrThrow({ where: { id: scope.projectId } })).clientId
    : scope.clientId!;
  requireClientRole(ctx, clientIdForAuth, WRITE_ROLES);

  return db.$transaction(async (tx) => {
    const override = await tx.budgetOverride.create({
      data: {
        clientId: scope.clientId ?? null,
        projectId: scope.projectId ?? null,
        approvedByUserId: ctx.userId,
      },
    });

    await recordAuditEvent(tx, {
      projectId: scope.projectId,
      actor: "USER",
      userId: ctx.userId,
      actorName: ctx.displayName,
      action: `${ctx.displayName} approved an AI budget override for ${scope.projectId ? "this project" : "this client"}`,
      detail: { clientId: scope.clientId ?? clientIdForAuth, projectId: scope.projectId ?? null, budgetOverrideId: override.id },
    });

    return override;
  });
}
