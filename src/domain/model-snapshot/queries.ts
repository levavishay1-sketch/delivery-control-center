import { db } from "@/lib/db";
import type { ModelSnapshot } from "@/generated/prisma/client";
import { estimateExecutorCost, type ExecutorCostEstimate } from "@/domain/agent/queries";
import { resolveDefaultAgentId } from "@/domain/agent/commands";
import { getWorkItemById } from "@/domain/work-item/queries";
import { getProjectById } from "@/domain/project/queries";
import { NotFoundError } from "@/domain/shared/errors";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";
import type { AuthContext } from "@/domain/shared/context";
import type { ExtractedModelFact } from "@/lib/integrations/modelKnowledgeSource";

/** Most recent successfully-extracted snapshot, or null if none has ever succeeded yet. */
export async function getLatestSuccessfulModelSnapshot(): Promise<ModelSnapshot | null> {
  return db.modelSnapshot.findFirst({ where: { status: "SUCCESS" }, orderBy: { fetchedAt: "desc" } });
}

export interface ModelRecommendation {
  model: string;
  why: string;
  assumptions: string[];
  /** Same historical-average figure Slice 17's executor recommendation uses (design.md Decision 6) — not a second, competing estimate. */
  aiEstimate: ExecutorCostEstimate | null;
  /** ISO timestamp of the snapshot this recommendation was grounded in, or null when falling back to built-in defaults (no successful snapshot exists yet). */
  snapshotFetchedAt: string | null;
}

/**
 * Recommends a model for a WorkItem whose executor is AI: confirms the currently-configured
 * default Agent's model using the latest successful ModelSnapshot's facts, or flags it as
 * possibly stale if the snapshot no longer lists it (design.md Decision 5 — this slice does not
 * score/compare across multiple models). Falls back to the built-in default when no successful
 * snapshot has been recorded yet. Read-only/informational, gated at ALL_ROLES like
 * recommendExecutor (Slice 17).
 */
export async function recommendModel(ctx: AuthContext, workItemId: string): Promise<ModelRecommendation> {
  const workItem = await getWorkItemById(workItemId);
  if (!workItem) throw new NotFoundError("Work item not found");
  const project = await getProjectById(workItem.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, ALL_ROLES);

  const aiEstimate = await estimateExecutorCost(workItem.type, workItem.risk, workItem.priority);

  const agentId = await resolveDefaultAgentId();
  const agent = await db.agent.findUniqueOrThrow({ where: { id: agentId } });

  const snapshot = await getLatestSuccessfulModelSnapshot();
  if (!snapshot) {
    return {
      model: agent.model,
      why: `No model knowledge snapshot has been recorded yet, so this confirms the currently configured model (${agent.model}) using this system's built-in defaults rather than a dated, current source.`,
      assumptions: ["No successful weekly model knowledge snapshot has been recorded yet."],
      aiEstimate,
      snapshotFetchedAt: null,
    };
  }

  const models = snapshot.extractedModels as unknown as ExtractedModelFact[];
  const match = models.find((m) => m.modelId === agent.model.toLowerCase());
  const fetchedAtLabel = snapshot.fetchedAt.toISOString();

  if (!match) {
    return {
      model: agent.model,
      why: `The currently configured model (${agent.model}) was not found in the latest model knowledge snapshot (fetched ${fetchedAtLabel}) — it may have been renamed or deprecated. Confirming it anyway since no alternative has been established for this system.`,
      assumptions: [`Latest snapshot (fetched ${fetchedAtLabel}) did not list "${agent.model}".`],
      aiEstimate,
      snapshotFetchedAt: fetchedAtLabel,
    };
  }

  const facts = [match.pricingText, match.contextWindowText].filter((f): f is string => Boolean(f));
  return {
    model: agent.model,
    why: `Confirming the currently configured model (${agent.model}) using the latest model knowledge snapshot (fetched ${fetchedAtLabel})${facts.length > 0 ? `: ${facts.join("; ")}` : "."}`,
    assumptions: [`Latest snapshot fetched ${fetchedAtLabel}.`, ...facts],
    aiEstimate,
    snapshotFetchedAt: fetchedAtLabel,
  };
}
