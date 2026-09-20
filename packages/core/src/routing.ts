import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { appendEvent, withTenant } from "@dcc/db";
import { clientBudget } from "@dcc/db/schema";

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
  | "execution"
  | "onboarding_init"
  | "onboarding_assistant";

export type Tier = "haiku" | "sonnet" | "opus";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

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
    { default: Tier; effort?: Effort; escalateOn?: Record<string, unknown>[]; downgradeOn?: Record<string, unknown>[]; maxUsdPerCall?: number }
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
  effort: Effort;
  budgetUsd: number;
  rationale: string;
};

const DEFAULT_EFFORT: Effort = "medium";

/** The recommendation a capability carries in the policy — model + effort
 *  — before any per-call signal or a person's override is applied. This is
 *  what a "before you run this" screen shows; `route()` below is the same
 *  computation plus signal-driven escalation. */
export function recommend(capability: Capability, overrides?: Partial<Policy>): { model: string; tier: Tier; effort: Effort } {
  const policy = { ...loadPolicy(), ...overrides };
  const cap = policy.capabilities[capability] ?? { default: "sonnet" as Tier };
  const tier = cap.default;
  return { model: policy.tiers[tier].model, tier, effort: cap.effort ?? DEFAULT_EFFORT };
}

export function route(
  capability: Capability,
  signals: RoutingSignals = {},
  overrides?: Partial<Policy>,
  /** A person's explicit choice for this one call — wins over both the
   *  policy default and any signal-driven escalation, per field. */
  choice?: { model?: string; effort?: Effort },
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
  // A capability may carry its own per-call cap when its calls need more
  // room than the tier's default; the cap is the larger of the two, never
  // below the tier's.
  const budgetUsd = Math.max(t.maxUsdPerCall, cap.maxUsdPerCall ?? 0);
  let model = t.model;
  let effort: Effort = cap.effort ?? DEFAULT_EFFORT;
  if (choice?.model && choice.model !== model) { model = choice.model; why.push(`model overridden by user (${choice.model})`); }
  if (choice?.effort && choice.effort !== effort) { effort = choice.effort; why.push(`effort overridden by user (${choice.effort})`); }
  return { capability, tier, model, effort, budgetUsd, rationale: why.join("; ") };
}

/** Write the audit event. Call when a model is actually invoked. */
export async function recordRouting(input: {
  clientId: string;
  workitemId: string | null;
  by: { userId: string };
  decision: RoutingDecision;
  /** actual spend for this call, if known. Falls back to a fraction of the budget as an estimate. */
  actualUsd?: number;
}) {
  const spent = input.actualUsd ?? input.decision.budgetUsd * 0.25;
  await withTenant(input.clientId, (tx) =>
    tx
      .update(clientBudget)
      .set({ spentUsd: sql`${clientBudget.spentUsd} + ${spent}` })
      .where(sql`${clientBudget.clientId} = ${input.clientId}`),
  );

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
