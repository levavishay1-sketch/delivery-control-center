import { route } from "./routing.js";
export async function summariseTimeline(entries) {
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
//# sourceMappingURL=summarise.js.map