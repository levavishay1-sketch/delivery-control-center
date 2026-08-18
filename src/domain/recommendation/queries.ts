import { estimateExecutorCost } from "@/domain/agent/queries";
import { getWorkItemById } from "@/domain/work-item/queries";
import { getProjectById } from "@/domain/project/queries";
import { NotFoundError } from "@/domain/shared/errors";
import { requireClientRole, ALL_ROLES } from "@/domain/shared/authz";
import type { AuthContext } from "@/domain/shared/context";
import type { ExecutorCostEstimate } from "@/domain/agent/queries";

/**
 * Slice 17 — a heuristic (not a learned model) threshold: below this, the estimated AI cost is
 * treated as cheap enough to prefer AI for LOW/MEDIUM risk work. "Entirely new scoring engine"
 * per the blueprint means new to the product, not necessarily ML-based (design.md decision 2) —
 * a stated, explainable threshold keeps the "why" honest and in plain language.
 */
const AI_COST_THRESHOLD_USD = 5;

export interface ExecutorRecommendation {
  recommended: "AI_AGENT" | "HUMAN";
  why: string;
  assumptions: string[];
  /** Always populated when any cost history exists, even when a developer is recommended — the card must show it regardless (spec requirement). */
  aiEstimate: ExecutorCostEstimate | null;
}

/**
 * Computes an AI-vs-developer executor recommendation for a WorkItem from existing signals only:
 * risk/priority/type plus historical AgentRun cost/duration (Slice 3). Read-only — informational,
 * gated at ALL_ROLES since a recommendation is not a mutation (design.md task 2.1).
 */
export async function recommendExecutor(ctx: AuthContext, workItemId: string): Promise<ExecutorRecommendation> {
  const workItem = await getWorkItemById(workItemId);
  if (!workItem) throw new NotFoundError("Work item not found");
  const project = await getProjectById(workItem.projectId);
  if (!project) throw new NotFoundError("Project not found");
  requireClientRole(ctx, project.clientId, ALL_ROLES);

  const aiEstimate = await estimateExecutorCost(workItem.type, workItem.risk, workItem.priority);

  if (!aiEstimate) {
    return {
      recommended: "HUMAN",
      why: "No AI drafting history exists yet to base a cost/time estimate on, so a developer is recommended by default.",
      assumptions: ["No completed AI drafting runs found for any work item type."],
      aiEstimate: null,
    };
  }

  const highRisk = workItem.risk === "HIGH" || workItem.risk === "CRITICAL";
  const expensive = aiEstimate.costUsd >= AI_COST_THRESHOLD_USD;

  if (highRisk) {
    return {
      recommended: "HUMAN",
      why: `This work item's risk is ${workItem.risk}, which this system treats as needing a developer's judgment rather than AI execution.`,
      assumptions: [`Risk level: ${workItem.risk}`, matchLevelAssumption(aiEstimate)],
      aiEstimate,
    };
  }

  if (expensive) {
    return {
      recommended: "HUMAN",
      why: `The estimated AI-execution cost ($${aiEstimate.costUsd.toFixed(2)}) is at or above the $${AI_COST_THRESHOLD_USD.toFixed(2)} threshold this system uses to prefer a developer instead.`,
      assumptions: [`Estimated AI cost: $${aiEstimate.costUsd.toFixed(2)}`, matchLevelAssumption(aiEstimate)],
      aiEstimate,
    };
  }

  return {
    recommended: "AI_AGENT",
    why: `Risk is ${workItem.risk} and the estimated AI-execution cost ($${aiEstimate.costUsd.toFixed(2)}) is below the $${AI_COST_THRESHOLD_USD.toFixed(2)} threshold, so AI execution is recommended.`,
    assumptions: [`Risk level: ${workItem.risk}`, `Estimated AI cost: $${aiEstimate.costUsd.toFixed(2)}`, matchLevelAssumption(aiEstimate)],
    aiEstimate,
  };
}

function matchLevelAssumption(estimate: ExecutorCostEstimate): string {
  if (estimate.matchLevel === "exact") {
    return `Based on ${estimate.sampleSize} past run(s) of work items with the same type, risk, and priority.`;
  }
  if (estimate.matchLevel === "type") {
    return `No history for this exact risk/priority combination — based on ${estimate.sampleSize} past run(s) of the same work item type.`;
  }
  return `No history for this work item type — based on ${estimate.sampleSize} past run(s) across all work item types.`;
}

export type { ExecutorCostEstimate };
