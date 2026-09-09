/**
 * The model seam for the Context Brief (architecture §6, §10).
 *
 * EVERY AI call in the system goes through model routing — so when this
 * grows an LLM path, it declares its capability ("brief") to the policy,
 * which picks a model + budget and records the choice as a `model.routed`
 * event. Phase 0 ships the no-LLM path: the brief is assembled from
 * structured state and the recent timeline lines are passed through raw.
 *
 * The router itself is a fixed cheap model (no infinite regress); it is
 * not wired in Phase 0.
 */

export type TimelineEntry = {
  occurredAt: Date;
  source: string;
  type: string;
  payload: unknown;
};

export type TimelineSummary =
  | { mode: "raw"; modelUsed: "assembled/v0" }
  | { mode: "summarised"; text: string; modelUsed: string };

export async function summariseTimeline(_entries: TimelineEntry[]): Promise<TimelineSummary> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { mode: "raw", modelUsed: "assembled/v0" };
  }
  // TODO(phase-1): route through the model policy, emit `model.routed`,
  // condense free-text event bodies into 3-6 sentences. Until then, even
  // with a key present, fall back to raw so behaviour is predictable.
  return { mode: "raw", modelUsed: "assembled/v0" };
}
