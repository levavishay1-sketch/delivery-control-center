import { route, type RoutingDecision } from "./routing.ts";

/**
 * The model seam for the Context Brief (architecture §6, §10).
 *
 * Phase 0/1 ships the no-LLM path: the brief is assembled from
 * structured state and the recent timeline lines pass through raw. When
 * an LLM path lights up here it goes through `route("brief" | "narrative")`
 * first and the caller records a `model.routed` event.
 *
 * The router itself is fixed rules (no regress); it is wired now so the
 * LLM path only has to fill in the call, not the routing.
 */

export type TimelineEntry = {
  occurredAt: Date;
  source: string;
  type: string;
  payload: unknown;
};

export type TimelineSummary =
  | { mode: "raw"; modelUsed: "assembled/v0"; routing?: undefined }
  | { mode: "summarised"; text: string; modelUsed: string; routing: RoutingDecision };

export async function summariseTimeline(entries: TimelineEntry[]): Promise<TimelineSummary> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { mode: "raw", modelUsed: "assembled/v0" };
  }

  // The routing decision is made even though the call below is still a
  // stub — this is the contract wired ahead of the implementation.
  const decision = route("narrative", { recentEvents: entries.length });
  void decision;

  // TODO(phase-2): call `decision.model`, condense the free-text event
  // bodies into 3–6 sentences, have the caller `recordRouting()`.
  // Until then, fall back to raw so behaviour stays predictable.
  return { mode: "raw", modelUsed: "assembled/v0" };
}
