import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Model routing (architecture §6, claude-in-dcc §6.3 / §8.3 / §9.9).
 * EVERY call to Claude goes through `route()` inside `runClaudeRaw`, and
 * the decision — tier, model, effort, cap, the rule that fired, the policy
 * version — is written on the call's ledger row. The router is
 * deterministic rules, not a model (no infinite regress).
 *
 * Resolution order (global → client → workitem, most specific wins) is a
 * deep-merge of policy layers; `route()` takes an `overrides` layer so a
 * client layer slots in without a signature change.
 */

export type Capability =
  | "gap_detection"
  | "decomposition"
  | "execution"
  | "onboarding_init"
  | "onboarding_assistant"
  | "chat"
  | "chat_code_read"
  | "conversation_summary"
  | "usage_insights"
  | "interactive_session"
  | "retro"
  | "client_letter";

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

export type ModelPrice = { input: number; cacheWrite: number; cacheRead: number; output: number };

export type CapabilityPolicy = {
  default: Tier;
  effort?: Effort;
  escalateOn?: Record<string, unknown>[];
  downgradeOn?: Record<string, unknown>[];
  maxUsdPerCall?: number;
  /** A chat call whose input passes this is refused and recorded (claude-in-dcc §2.12). */
  maxInputTokens?: number;
};

export type ChatPolicy = {
  rolloverInputTokens: number;
  rolloverColdDays: number;
  retentionDays: number;
  declareCostAboveUsd: number;
  insightsMinRepeats: number;
};

export type Policy = {
  version: number;
  tiers: Record<Tier, { model: string; maxUsdPerCall: number }>;
  prices: Record<string, ModelPrice>;
  capabilities: Record<string, CapabilityPolicy>;
  chat: ChatPolicy;
  guardrails: { killAfterStuckIterations: number; budgetWarnAtFraction: number };
};

export const POLICY_PATH = fileURLToPath(new URL("../../../config/model-policy.json", import.meta.url));

let cached: Policy | null = null;
export function loadPolicy(): Policy {
  if (!cached) cached = JSON.parse(readFileSync(POLICY_PATH, "utf8")) as Policy;
  return cached;
}
/** After the file changed on disk (the control center's editor writes it). */
export function reloadPolicy(): Policy {
  cached = null;
  return loadPolicy();
}
/** Write the policy back — the editor's path. Bumps `version`; keeps the file's `$comment` keys. */
export function savePolicy(next: Policy): Policy {
  const raw = JSON.parse(readFileSync(POLICY_PATH, "utf8")) as Record<string, unknown>;
  const merged = { ...raw, ...next, version: (loadPolicy().version ?? 0) + 1 };
  writeFileSync(POLICY_PATH, JSON.stringify(merged, null, 2) + "\n", "utf8");
  return reloadPolicy();
}

/** The policy's chat values with the file's defaults as the floor. */
export const chatPolicy = (): ChatPolicy => {
  const defaults: ChatPolicy = { rolloverInputTokens: 40_000, rolloverColdDays: 14, retentionDays: 90, declareCostAboveUsd: 0.1, insightsMinRepeats: 5 };
  return { ...defaults, ...(loadPolicy().chat ?? {}) };
};

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
  maxInputTokens: number | null;
  rationale: string;
  policyVersion: number;
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
  choice?: { model?: string | undefined; effort?: Effort | string | undefined },
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
  if (choice?.effort && choice.effort !== effort) { effort = choice.effort as Effort; why.push(`effort overridden by user (${choice.effort})`); }
  return { capability, tier, model, effort, budgetUsd, maxInputTokens: cap.maxInputTokens ?? null, rationale: why.join("; "), policyVersion: policy.version };
}

/** List price for a model id, or for a tier alias the CLI accepts ("haiku", "sonnet", "opus"). */
export function priceFor(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  const policy = loadPolicy();
  const id = policy.tiers[model as Tier]?.model ?? model;
  return policy.prices[id] ?? Object.entries(policy.prices).find(([k]) => id.startsWith(k.replace(/-\d{8}$/, "")))?.[1] ?? null;
}

/** What a call would cost from its tokens, at list price — the estimate a
 *  declared-cost card shows and the recomputation the ledger allows. */
export function estimateUsd(model: string | null | undefined, tokens: { input?: number; cacheRead?: number; cacheWrite?: number; output?: number }): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const m = 1_000_000;
  return ((tokens.input ?? 0) * p.input + (tokens.cacheRead ?? 0) * p.cacheRead + (tokens.cacheWrite ?? 0) * p.cacheWrite + (tokens.output ?? 0) * p.output) / m;
}
