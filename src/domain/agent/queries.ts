import { db } from "@/lib/db";
import { Prisma, type WorkItemType, type RiskLevel, type PriorityLevel } from "@/generated/prisma/client";
import type { AuthContext } from "@/domain/shared/context";
import { requireClientRole, ALL_ROLES, WRITE_ROLES } from "@/domain/shared/authz";

/** The registry's current default agent — the one config/workflow.yaml's `agents:` list marks `default: true`. */
export function getDefaultAgent() {
  return db.agent.findFirst({ where: { isDefault: true } });
}

export function getAgentById(id: string) {
  return db.agent.findUnique({ where: { id } });
}

export function listAgents() {
  return db.agent.findMany({ orderBy: { name: "asc" } });
}

/** The AgentRun tracking a given Job's attempt-cycle, if one has been started yet. */
export function getAgentRunByJobId(jobId: string) {
  return db.agentRun.findFirst({ where: { jobId } });
}

const ZERO_USD = new Prisma.Decimal(0);

/**
 * Total AI drafting cost across every stage draft/redraft under a single work item's pipeline.
 * Sums AgentRun.costUsd reached through StageVersion — every draft/redraft, not just a Stage's
 * current one (design.md Decision 2: Stage.agentRunId only ever points at the latest). A failed
 * AgentRun never gets a costUsd (completeAgentRun is the only writer of that field), so this
 * naturally counts only completed attempts, and each AgentRun backs exactly one StageVersion, so
 * there's nothing to double-count.
 */
export async function getWorkItemAiCost(workItemId: string) {
  const result = await db.agentRun.aggregate({
    where: { stageVersions: { some: { stage: { pipeline: { workItemId } } } } },
    _sum: { costUsd: true },
  });
  return result._sum.costUsd ?? ZERO_USD;
}

/** Total AI drafting cost across a project: every work item's stage drafts plus every Constitution version drafted for it. */
export async function getProjectAiCost(projectId: string) {
  const [stages, constitutions] = await Promise.all([
    db.agentRun.aggregate({
      where: { stageVersions: { some: { stage: { pipeline: { workItem: { projectId } } } } } },
      _sum: { costUsd: true },
    }),
    db.agentRun.aggregate({
      where: { constitutions: { some: { projectId } } },
      _sum: { costUsd: true },
    }),
  ]);
  return (stages._sum.costUsd ?? ZERO_USD).add(constitutions._sum.costUsd ?? ZERO_USD);
}

/** Total AI drafting cost across every project under every client in an organization (Slice 6 — the fallback budget scope above Client), plus every Discovery run for one of its repositories (Slice 14). */
export async function getOrganizationAiCost(organizationId: string) {
  const [stages, constitutions, repositoryDiscoveries] = await Promise.all([
    db.agentRun.aggregate({
      where: { stageVersions: { some: { stage: { pipeline: { workItem: { project: { client: { organizationId } } } } } } } },
      _sum: { costUsd: true },
    }),
    db.agentRun.aggregate({
      where: { constitutions: { some: { project: { client: { organizationId } } } } },
      _sum: { costUsd: true },
    }),
    db.agentRun.aggregate({
      where: { repositoryDiscoveries: { some: { repository: { client: { organizationId } } } } },
      _sum: { costUsd: true },
    }),
  ]);
  return (stages._sum.costUsd ?? ZERO_USD).add(constitutions._sum.costUsd ?? ZERO_USD).add(repositoryDiscoveries._sum.costUsd ?? ZERO_USD);
}

/**
 * Loads an AgentRun and the client that owns it, for authorization. Ownership is normally
 * resolved through whichever Stage/Constitution the run's StageVersion/Constitution row
 * references — but a still-RUNNING run has neither yet (those links are only written on
 * completion), so this falls back to the owning Job's payload (stageId/constitutionId) to
 * resolve ownership even mid-draft.
 */
async function loadAgentRunWithClientId(runId: string) {
  const run = await db.agentRun.findUnique({
    where: { id: runId },
    include: {
      agent: true,
      job: true,
      stageVersions: {
        take: 1,
        include: { stage: { include: { pipeline: { include: { workItem: { include: { project: true } } } } } } },
      },
      constitutions: { take: 1, include: { project: true } },
      // Slice 14 — a Discovery run's owning client, resolved the same optional-chain way as the
      // other two legs above.
      repositoryDiscoveries: { take: 1, include: { repository: true } },
    },
  });
  if (!run) return null;

  let clientId: string | null =
    run.stageVersions[0]?.stage.pipeline.workItem.project.clientId ??
    run.constitutions[0]?.project.clientId ??
    run.repositoryDiscoveries[0]?.repository.clientId ??
    null;

  if (!clientId && run.job) {
    const payload = run.job.payload as { stageId?: string; constitutionId?: string; repositoryDiscoveryId?: string };
    if (payload.stageId) {
      const stage = await db.stage.findUnique({
        where: { id: payload.stageId },
        include: { pipeline: { include: { workItem: { include: { project: true } } } } },
      });
      clientId = stage?.pipeline.workItem.project.clientId ?? null;
    } else if (payload.constitutionId) {
      const constitution = await db.constitution.findUnique({
        where: { id: payload.constitutionId },
        include: { project: true },
      });
      clientId = constitution?.project.clientId ?? null;
    } else if (payload.repositoryDiscoveryId) {
      const discovery = await db.repositoryDiscovery.findUnique({
        where: { id: payload.repositoryDiscoveryId },
        include: { repository: true },
      });
      clientId = discovery?.repository.clientId ?? null;
    }
  }

  return { run, clientId };
}

/**
 * Full AgentRun detail — structured error, token breakdown, everything — restricted to
 * write-capable roles (design.md's permissioned-visibility requirement). Returns null for a
 * run that doesn't exist; throws ForbiddenError (via requireClientRole) for a run a caller
 * lacks write access to.
 */
export async function getAgentRunDetail(ctx: AuthContext, runId: string) {
  const loaded = await loadAgentRunWithClientId(runId);
  if (!loaded) return null;
  if (loaded.clientId) requireClientRole(ctx, loaded.clientId, WRITE_ROLES);
  const {
    id,
    agentId,
    agent,
    jobId,
    status,
    promptTokens,
    completionTokens,
    costUsd,
    retryCount,
    lastError,
    toolCalls,
    startedAt,
    completedAt,
    createdAt,
  } = loaded.run;
  return {
    id,
    agentId,
    agent,
    jobId,
    status,
    promptTokens,
    completionTokens,
    costUsd,
    retryCount,
    lastError,
    toolCalls,
    startedAt,
    completedAt,
    createdAt,
  };
}

/**
 * Status/cost summary only — no structured error, no tool calls — visible to any role with at
 * least read access to the owning client. What a read-only viewer sees instead of full detail.
 */
export async function getAgentRunSummary(ctx: AuthContext, runId: string) {
  const loaded = await loadAgentRunWithClientId(runId);
  if (!loaded) return null;
  if (loaded.clientId) requireClientRole(ctx, loaded.clientId, ALL_ROLES);
  const { id, agentId, agent, status, promptTokens, completionTokens, costUsd, startedAt, completedAt, createdAt } =
    loaded.run;
  return { id, agentId, agent, status, promptTokens, completionTokens, costUsd, startedAt, completedAt, createdAt };
}

export interface ExecutorCostEstimate {
  costUsd: number;
  durationMinutes: number;
  sampleSize: number;
  /** How closely the sample matched the target WorkItem — narrows the "why" shown to the user (Slice 17 design.md decision 1). */
  matchLevel: "exact" | "type" | "global";
}

async function averageCompletedRuns(where: { type?: WorkItemType; risk?: RiskLevel; priority?: PriorityLevel }) {
  const runs = await db.agentRun.findMany({
    where: {
      completedAt: { not: null },
      costUsd: { not: null },
      stageVersions: { some: { stage: { pipeline: { workItem: where } } } },
    },
    select: { costUsd: true, startedAt: true, completedAt: true },
  });
  if (runs.length === 0) return null;

  const totalCost = runs.reduce((sum, r) => sum + (r.costUsd?.toNumber() ?? 0), 0);
  const totalDurationMs = runs.reduce((sum, r) => sum + (r.completedAt!.getTime() - r.startedAt.getTime()), 0);
  return {
    costUsd: totalCost / runs.length,
    durationMinutes: totalDurationMs / runs.length / 60_000,
    sampleSize: runs.length,
  };
}

/**
 * Slice 17 — an estimated AI-execution cost/duration for a WorkItem of this shape, averaged over
 * completed AgentRuns (a failed run never gets costUsd/completedAt, so this naturally counts only
 * successful attempts). Falls back from an exact type+risk+priority match to a type-only match to
 * a global average across every completed run, so a fresh installation with thin history still
 * gets an honest (if broader) estimate rather than nothing; returns null only when there is no
 * completed AgentRun anywhere yet (design.md decision 1).
 */
export async function estimateExecutorCost(
  workItemType: WorkItemType,
  risk: RiskLevel,
  priority: PriorityLevel
): Promise<ExecutorCostEstimate | null> {
  const exact = await averageCompletedRuns({ type: workItemType, risk, priority });
  if (exact) return { ...exact, matchLevel: "exact" };

  const typeOnly = await averageCompletedRuns({ type: workItemType });
  if (typeOnly) return { ...typeOnly, matchLevel: "type" };

  const global = await averageCompletedRuns({});
  if (global) return { ...global, matchLevel: "global" };

  return null;
}

/** Total AI drafting cost across every project under a client, plus every Discovery run for one of its repositories (Slice 14). */
export async function getClientAiCost(clientId: string) {
  const [stages, constitutions, repositoryDiscoveries] = await Promise.all([
    db.agentRun.aggregate({
      where: { stageVersions: { some: { stage: { pipeline: { workItem: { project: { clientId } } } } } } },
      _sum: { costUsd: true },
    }),
    db.agentRun.aggregate({
      where: { constitutions: { some: { project: { clientId } } } },
      _sum: { costUsd: true },
    }),
    db.agentRun.aggregate({
      where: { repositoryDiscoveries: { some: { repository: { clientId } } } },
      _sum: { costUsd: true },
    }),
  ]);
  return (stages._sum.costUsd ?? ZERO_USD).add(constitutions._sum.costUsd ?? ZERO_USD).add(repositoryDiscoveries._sum.costUsd ?? ZERO_USD);
}
