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
export type Capability = "brief" | "matching" | "narrative" | "gap_detection" | "decomposition" | "review" | "execution";
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
    tiers: Record<Tier, {
        model: string;
        maxUsdPerCall: number;
    }>;
    capabilities: Record<string, {
        default: Tier;
        escalateOn?: Record<string, unknown>[];
        downgradeOn?: Record<string, unknown>[];
    }>;
    guardrails: {
        killAfterStuckIterations: number;
        budgetWarnAtFraction: number;
    };
};
export declare function loadPolicy(): Policy;
export type RoutingDecision = {
    capability: Capability;
    tier: Tier;
    model: string;
    budgetUsd: number;
    rationale: string;
};
export declare function route(capability: Capability, signals?: RoutingSignals, overrides?: Partial<Policy>): RoutingDecision;
/** Write the audit event. Call when a model is actually invoked. */
export declare function recordRouting(input: {
    clientId: string;
    workitemId: string | null;
    by: {
        userId: string;
    };
    decision: RoutingDecision;
    /** actual spend for this call, if known. Falls back to a fraction of the budget as an estimate. */
    actualUsd?: number;
}): Promise<{
    type: string;
    workitemId: string | null;
    id: string;
    clientId: string;
    occurredAt: Date;
    source: "email" | "slack" | "phone" | "meeting" | "claude_session" | "git" | "ado" | "manual" | "system";
    actor: import("@dcc/db/schema").EventActor;
    supersedes: string | null;
    links: import("@dcc/db/schema").EventLink[];
    payload: Record<string, unknown>;
    recordedAt: Date;
    schemaVersion: number;
} | undefined>;
//# sourceMappingURL=routing.d.ts.map