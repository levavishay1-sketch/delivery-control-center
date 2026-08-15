import { db } from "@/lib/db";
import { loadAgents } from "@/lib/config";
import { getAgentById, getDefaultAgent } from "@/domain/agent/queries";
import type { Prisma, StageType } from "@/generated/prisma/client";

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
