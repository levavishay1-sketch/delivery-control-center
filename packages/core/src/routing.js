import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { appendEvent, withTenant } from "@dcc/db";
import { clientBudget } from "@dcc/db/schema";
const GLOBAL_POLICY_PATH = fileURLToPath(new URL("../../../config/model-policy.json", import.meta.url));
let cached = null;
export function loadPolicy() {
    if (!cached)
        cached = JSON.parse(readFileSync(GLOBAL_POLICY_PATH, "utf8"));
    return cached;
}
const ORDER = { low: 0, medium: 1, high: 2 };
function meets(signals, cond) {
    for (const [k, v] of Object.entries(cond)) {
        const s = signals[k];
        if (k === "ambiguity" || k === "novelty") {
            if (s === undefined)
                return false;
            if (ORDER[s] < ORDER[v])
                return false;
        }
        else if (typeof v === "number") {
            if (typeof s !== "number" || s < v)
                return false;
        }
        else if (typeof v === "boolean") {
            if (s !== v)
                return false;
        }
    }
    return true;
}
const bump = (t) => (t === "haiku" ? "sonnet" : "opus");
const drop = (t) => (t === "opus" ? "sonnet" : "haiku");
export function route(capability, signals = {}, overrides) {
    const policy = { ...loadPolicy(), ...overrides };
    const cap = policy.capabilities[capability] ?? { default: "sonnet" };
    let tier = cap.default;
    const why = [`default ${tier} for ${capability}`];
    const hit = cap.escalateOn?.find((c) => meets(signals, c));
    const low = cap.downgradeOn?.find((c) => meets(signals, c));
    if (hit) {
        tier = bump(tier);
        why.push(`escalated (${Object.keys(hit).join("+")})`);
    }
    else if (low) {
        tier = drop(tier);
        why.push(`downgraded (${Object.keys(low).join("+")})`);
    }
    const t = policy.tiers[tier];
    return { capability, tier, model: t.model, budgetUsd: t.maxUsdPerCall, rationale: why.join("; ") };
}
/** Write the audit event. Call when a model is actually invoked. */
export async function recordRouting(input) {
    const spent = input.actualUsd ?? input.decision.budgetUsd * 0.25;
    await withTenant(input.clientId, (tx) => tx
        .update(clientBudget)
        .set({ spentUsd: sql `${clientBudget.spentUsd} + ${spent}` })
        .where(sql `${clientBudget.clientId} = ${input.clientId}`));
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
//# sourceMappingURL=routing.js.map