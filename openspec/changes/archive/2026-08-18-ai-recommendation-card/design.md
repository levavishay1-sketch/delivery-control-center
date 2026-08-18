## Context

`AgentRun` (prisma/schema.prisma:775) has `costUsd`/`promptTokens`/`completionTokens` and
`startedAt`/`completedAt` (duration derivable) but no direct link to `WorkItem` — it joins via
`stageVersions → stage → pipeline → workItem`, the same relational path
`getProjectAiCost`/`getClientAiCost`/`getOrganizationAiCost` (`src/domain/agent/queries.ts`)
already use for budget-scope sums. Those existing queries only sum total cost per scope; none of
them group by `WorkItem.type`/`risk`/`priority` or compute duration, so this slice needs a new
query, following the same relational pattern rather than reusing those functions directly.
`WorkItem.executorType` already has a real `UNASSIGNED` state (`prisma/schema.prisma:478`) that
this recommendation targets. `updateWorkItem` (`src/domain/work-item/commands.ts`) already sets
`executorType`/`executorId` and (per Slice 19) marks `assignmentSource=EXPLICIT` on any direct
edit — the override action reuses this verbatim, no new mutation path.

## Decisions

### 1. A new `estimateExecutorCost(workItemType, risk, priority)` query, not a reuse of the budget-sum queries
Groups completed `AgentRun`s by the `WorkItem.type`/`risk`/`priority` of the stage they belong to
(same join path as `getProjectAiCost`), averaging `costUsd` and `(completedAt - startedAt)` for
runs matching the target WorkItem's type/risk/priority combination. Falls back to a
type-only average, then an org-wide average, when there's not enough matching history yet
(design decision 4 covers the empty-history case explicitly). Lives in
`src/domain/agent/queries.ts` alongside the existing cost-aggregation functions it's modeled on.

### 2. The "AI vs. developer" verdict is a simple threshold heuristic, not a new scoring engine
`recommendExecutor(workItem)` in a new `src/domain/recommendation/` module: recommends AI when
`risk` is `LOW` or `MEDIUM` and the estimated AI cost is below a fixed threshold constant;
recommends a developer otherwise (`HIGH`/`CRITICAL` risk, or an AI estimate the heuristic treats as
too expensive/uncertain to prefer). The blueprint calls this "entirely new scoring... engine" —
read as "new to the product," not "must be ML-based." A heuristic is honest (it's transparent, its
"why" is statable in plain language per the requirement) and matches this slice's bounded scope;
a learned model is a future enhancement, not blocked by this shape.

### 3. Estimated developer time/cost is out of scope for v1 — only the AI alternative is estimated
The requirement ("always shown, even if AI ends up not being the manager's final choice") is about
always showing the *AI* estimate. Estimating a *developer's* time/cost has no existing signal in
this codebase (no time-tracking, no developer cost-rate concept) and inventing one is real added
scope beyond "wire existing data into a shared card." The card's "what happens under each
alternative" section shows the AI estimate under both alternatives' framing (i.e., "if you choose
AI: est. $X/Y hours" and "if you choose a developer instead: the AI estimate above no longer
applies, developer effort isn't estimated by this system") — honest about what is and isn't
computed, not a fabricated developer estimate.

### 4. Empty-history fallback: recommend developer, state the assumption explicitly
When no historical `AgentRun` data matches even at the org-wide fallback level (a fresh
installation), `recommendExecutor` returns a developer recommendation with the "why" stating
plainly that there's no cost history yet to base an AI estimate on — never a fabricated number.
This keeps requirement 3's "estimate is derived from actual historical AgentRun records, not a
hardcoded constant" true in the zero-data case too.

### 5. Card renders on the Overview tab only, not a new page
Mirrors Slice 16/19's placement precedent (extend an existing surface, not add a page) — the
Overview tab (`src/components/OverviewTab.tsx`) already renders the executor field; the card
renders adjacent to it, conditionally, only when `executorType === "UNASSIGNED"`.

### 6. The override action is two buttons calling the existing `updateWorkItem`, not a new API route
"Assign to AI" sets `executorType: "AI_AGENT"`; "Assign to a developer" opens the existing
executor-picker flow (`EditWorkItemForm`'s `HUMAN`-type case) rather than duplicating a user
picker inside the card — clicking it is equivalent to today's "Edit → set executor" path, just
one click closer. No new API route: both funnel into the existing
`PATCH /api/work-items/[id]` → `updateWorkItem`.

## Non-Goals (explicit deferrals)

- Blocker criticality (§35) and Execution Readiness (§34) as recommendation inputs — neither
  exists in this codebase yet; incorporated once a later slice builds them (mirrors Slice 19's
  Decision Ownership deferral).
- AI model selection (which model, not just AI-vs-developer) and the weekly knowledge-snapshot job
  — Slice 20's job per the blueprint's own slice table.
- Applying the card shape to other AI-facing surfaces (repository relevance, decomposition,
  `Decision.aiRecommendation` itself) — this slice ships the shared component and its first use;
  migrating existing surfaces onto it is separate follow-up work, not required for this slice to
  be complete.
- Estimating developer time/cost — see decision 3.
