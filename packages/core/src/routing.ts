import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { appendEvent } from "@dcc/db";

/**
 * Model routing (architecture §6). EVERY AI call in the system goes
 * through here first — brief upkeep, matching, gap detection,
 * decomposition, execution, review. The router is deterministic rules,
 * not a model (no infinite regress). `route()` returns the decision;
 * `recordRouting()` writes the `model.routed` audit event — called only
 * when a model is actually invoked, so an assembled/no-LLM brief creates
 * no event.
 *
 * Resolution order (global → client → workitem, most specific wins) is
 * a deep-merge of policy layers. Phase 1 ships the global layer only;
 * `route()` already accepts an `overrides` layer so client/workitem
 * slots in without a signature change.
 */

export type Capability =
  | "brief"
  | "matching"
  | "narrative"
  | "gap_detection"
  | "decomposition"
  | "review"
  | "execution";

export type Tier = "haiku" | "sonnet" | "opus";

export type RoutingSignals = {
  ambiguity?: "low" | "medium" | "high";
  breadth?: number;
  reversible?: boolean;
  openGaps?: number;
  novelty?: "low" | "medium" | "high";
  recentEvents?: number;
  mechanical?: boolean;
};

export type Policy = {
  version: number;
  tiers: Record<Tier, { model: string; maxUsdPerCall: number }>;
  capabilities: Record<
    string,
    { default: Tier; escalateOn?: Record<string, unknown>[]; downgradeOn?: Record<string, unknown>[] }
  >;
  guardrails: { killAfterStuckIterations: number; budgetWarnAtFraction: number };
};

const GLOBAL_POLICY_PATH = fileURLToPath(new URL("../../../config/model-policy.json", import.meta.url));

let cached: Policy | null = null;
export function loadPolicy(): Policy {
  if (!cached) cached = JSON.parse(readFileSync(GLOBAL_POLICY_PATH, "utf8")) as Policy;
  return cached;
}

const ORDER: Record<"low" | "medium" | "high", number> = { low: 0, medium: 1, high: 2 };

function meets(signals: RoutingSignals, cond: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(cond)) {
    const s = (signals as Record<string, unknown>)[k];
    if (k === "ambiguity" || k === "novelty") {
      if (s === undefined) return false;
      if (ORDER[s as "low"] < ORDER[v as "low"]) return false;
    } else if (typeof v === "number") {
      if (typeof s !== "number" || s < v) return false;
    } else if (typeof v === "boolean") {
      if (s !== v) return false;
    }
  }
  return true;
}

const bump = (t: Tier): Tier => (t === "haiku" ? "sonnet" : "opus");
const drop = (t: Tier): Tier => (t === "opus" ? "sonnet" : "haiku");

export type RoutingDecision = {
  capability: Capability;
  tier: Tier;
  model: string;
  budgetUsd: number;
  rationale: string;
};

export function route(
  capability: Capability,
  signals: RoutingSignals = {},
  overrides?: Partial<Policy>,
): RoutingDecision {
  const policy = { ...loadPolicy(), ...overrides };
  const cap = policy.capabilities[capability] ?? { default: "sonnet" as Tier };
  let tier: Tier = cap.default;
  const why: string[] = [`default ${tier} for ${capability}`];

  const hit = cap.escalateOn?.find((c) => meets(signals, c));
  const low = cap.downgradeOn?.find((c) => meets(signals, c));
  if (hit) {
    tier = bump(tier);
    why.push(`escalated (${Object.keys(hit).join("+")})`);
  } else if (low) {
    tier = drop(tier);
    why.push(`downgraded (${Object.keys(low).join("+")})`);
  }

  const t = policy.tiers[tier];
  return { capability, tier, model: t.model, budgetUsd: t.maxUsdPerCall, rationale: why.join("; ") };
}

/** Write the audit event. Call when a model is actually invoked. */
export async function recordRouting(input: {
  clientId: string;
  workitemId: string | null;
  by: { userId: string };
  decision: RoutingDecision;
}) {
  return appendEvent({
    clientId: input.clientId,
    workitemId: input.workitemId,
    source: "system",
    type: "model.routed",
    actor: { kind: "delegated", userId: input.by.userId, identityType: "delegated", triggeredBy: "router" },
    payload: {
      capability: input.decision.capability,
      model: input.decision.model,
      budgetUsd: input.decision.budgetUsd,
      rationale: input.decision.rationale,
    },
  });
}
