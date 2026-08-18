## Roadmap Source

Implements `docs/ROADMAP.md`'s Slice 17 stub, scoped from
`docs/roadmap-sources/2026-08-16-product-vision-blueprint.md` §4 and §5.7:

> "§4. Cross-cutting pattern: the 'AI Recommendation' card ... should produce the **same shape** of
> recommendation, not a bespoke UI per feature: **What** AI recommends; **Why** (reasoning, in
> plain language); **What assumptions** were used; **Estimated time**, when execution is involved;
> **Estimated cost**, when AI execution is a candidate — always shown, even if AI ends up not being
> the manager's final choice, and always shown if the manager picks AI despite a developer
> recommendation; **What happens under each alternative** ('if you assign to a developer
> instead...', 'if you keep the current model instead...'); A single, consistent override action —
> the manager's choice is never blocked by AI's opinion. This is the same shape
> `Decision.aiRecommendation` and the pipeline gate-decision UI already use today — the target is
> to make it the **one** recommendation pattern product-wide."
>
> "§5.7 AI vs. Developer recommendation, with estimate: An AI Recommendation card (§4) on any
> unassigned unit of work, always including estimated time and cost for the AI-execution option
> even when AI recommends a developer, so the manager can compare before overriding. Entirely new
> scoring + estimate engine; benefits from but isn't blocked by §5.3/§5.4 repo context."

`docs/roadmap-sources/2026-08-17-core-product-definition-gap-analysis.md`'s Part 3 (row 17) notes
the card pattern "isn't contradicted by the new spec, though it should incorporate Blocker
criticality (§35) and Execution Readiness (§34) once those exist." Both are confirmed absent from
this codebase (`Blocker` has no severity field; `Execution Readiness` doesn't exist as a concept
anywhere). Checking their actual definitions in
`docs/roadmap-sources/2026-08-17-core-product-definition.md`, neither is part of the card's
required shape above: §34 ("Approval Is Not Execution Readiness") is about whether a work item is
executable at all (approval + AI readiness + dependency readiness + inputs); §35 ("Blocker
Criticality") is a severity taxonomy for `Blocker` rows. Both are enrichments a later slice can add
once they exist — the same "build the concrete buildable subset now, defer the rest" precedent this
session already applied to Slice 19 (which built the Project→WorkItem executor-assignment subset of
the broader §23 Responsibility Transfer principle without waiting for Decision Ownership to exist).

## Why

Every AI-facing surface in this product currently invents its own ad hoc way of showing an AI
opinion: `Decision.aiRecommendation` is free text rendered inline; the pipeline's gate-decision UI
has its own shape; nothing at all exists yet for "should this WorkItem be executed by AI or a
developer." The blueprint's own diagnosis is that this fragmentation is the problem: every future
AI-facing slice (model selection in Slice 20, task-decomposition recommendations, etc.) either
invents its own card again or the product accumulates inconsistent, one-off recommendation UIs.
Building the shared card now, on its first concrete real use case (executor recommendation), gives
every later AI-facing slice a component to reuse instead of a pattern to rediscover.

## What Changes

- A new shared `AiRecommendationCard` UI component with the fixed shape: What / Why / Assumptions /
  Estimated time / Estimated cost / What happens under each alternative / a single override action
  with no pre-selected default (mirrors Slice 19's own no-default-pre-selected precedent).
- A new domain function computing an AI-vs-developer executor recommendation for a WorkItem from
  existing signals only — `risk`/`priority`/`type` plus historical `AgentRun` cost/token/duration
  averages already recorded by Slice 3's cost tracking — no new scoring infrastructure invented
  beyond the heuristic itself, and no new data model.
- The card always includes an AI-execution time/cost estimate even when a developer is the
  recommended executor, so a manager can compare before overriding (the blueprint's explicit
  acceptance criterion).
- Wired into the WorkItem's executor-assignment surface (Overview tab), rendered for a WorkItem
  whose executor is still unassigned, with an override action that calls the existing
  `updateWorkItem` command to set the chosen executor — no new mutation path.

## Capabilities

### New Capabilities
- `ai-recommendation`: the shared AI Recommendation card shape and its first concrete instance
  (AI-vs-developer executor recommendation for a WorkItem), including the domain-layer scoring
  function and its estimate output.

### Modified Capabilities
(none — this generalizes a pattern that today lives informally inside `Decision.aiRecommendation`
rendering, but does not change `Decision`'s own previously-specified requirements; the `decision`
capability's existing spec is untouched)

## Impact

- `src/domain/agent/queries.ts`: new query(ies) computing historical AgentRun cost/duration
  averages usable as an estimate basis (may already partially exist via
  `getClientAiCost`/`getProjectAiCost`/`getOrganizationAiCost` — reuse rather than duplicate where
  possible).
- New `src/domain/recommendation/` (or similar) domain module: the AI-vs-developer scoring
  function.
- `src/components/AiRecommendationCard.tsx`: new shared UI component.
- `src/components/OverviewTab.tsx`: renders the card for an unassigned WorkItem's executor field.
- No schema migration expected (reads existing fields only) — confirm during design.
