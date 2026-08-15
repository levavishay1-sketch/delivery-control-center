import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

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
