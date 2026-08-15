import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
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

/** Total AI drafting cost across every project under every client in an organization (Slice 6 — the fallback budget scope above Client). */
export async function getOrganizationAiCost(organizationId: string) {
  const [stages, constitutions] = await Promise.all([
    db.agentRun.aggregate({
      where: { stageVersions: { some: { stage: { pipeline: { workItem: { project: { client: { organizationId } } } } } } } },
      _sum: { costUsd: true },
    }),
    db.agentRun.aggregate({
      where: { constitutions: { some: { project: { client: { organizationId } } } } },
      _sum: { costUsd: true },
    }),
  ]);
  return (stages._sum.costUsd ?? ZERO_USD).add(constitutions._sum.costUsd ?? ZERO_USD);
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
    },
  });
  if (!run) return null;

  let clientId: string | null =
    run.stageVersions[0]?.stage.pipeline.workItem.project.clientId ?? run.constitutions[0]?.project.clientId ?? null;

  if (!clientId && run.job) {
    const payload = run.job.payload as { stageId?: string; constitutionId?: string };
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

/** Total AI drafting cost across every project under a client. */
export async function getClientAiCost(clientId: string) {
  const [stages, constitutions] = await Promise.all([
    db.agentRun.aggregate({
      where: { stageVersions: { some: { stage: { pipeline: { workItem: { project: { clientId } } } } } } },
      _sum: { costUsd: true },
    }),
    db.agentRun.aggregate({
      where: { constitutions: { some: { project: { clientId } } } },
      _sum: { costUsd: true },
    }),
  ]);
  return (stages._sum.costUsd ?? ZERO_USD).add(constitutions._sum.costUsd ?? ZERO_USD);
}
