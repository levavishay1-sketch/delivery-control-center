/**
 * Regenerate a WorkItem's Context Brief (architecture §10).
 *
 * Phase 0 brief is ASSEMBLED from structured state — open gaps, blocker,
 * task counts, decisions, the recent timeline — not LLM-summarised. It
 * is already what the SessionStart hook injects, so the next session
 * starts from the flow, not from zero.
 *
 * `summariseTimeline()` is the seam where a policy-chosen model condenses
 * the free-text event bodies once an API key is configured. Without one
 * it returns the raw recent lines. Either way the Brief is fresh on
 * every new event.
 */
export declare function regenerateBrief(clientId: string, workitemId: string): Promise<void>;
//# sourceMappingURL=generate.d.ts.map