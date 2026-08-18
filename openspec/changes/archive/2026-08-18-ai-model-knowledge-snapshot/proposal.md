## Roadmap Source

Implements Slice 20 of `docs/ROADMAP.md`'s "Slices 11–21 — Product Vision & Flow Blueprint" index
("a weekly (Sunday 07:00) job that fetches and extracts model/pricing/capability information from
`platform.claude.com/docs/en/about-claude/models/overview` into a structured, dated knowledge
snapshot, and uses it to recommend which model should execute a given AI task and why — replacing
any hardcoded model-cost assumption"), sourced from
`docs/roadmap-sources/2026-08-16-product-vision-blueprint.md` §3 (`AiModelKnowledgeSnapshot`) and
§5.8 (`AI model selection`), themselves derived from the user's verbatim Appendix Q1 answer:

> "There is an official and authoritative source: https://platform.claude.com/docs/en/about-claude/models/overview
> Once a week, every Sunday at 07:00, the AI should access this page and extract all relevant
> information about the models, including new models and changes, pricing, token economics,
> context limits, capabilities, recommended use cases, and any other information that could be
> relevant to model selection and AI execution planning. The goal is for the system to always
> maintain an up-to-date Knowledge Snapshot of Claude models rather than relying on hardcoded
> information that can become outdated."

And §5.8's summary of what's still missing on top of Slice 3's existing `Agent`/`AgentRun`
infrastructure:

> "When AI is the executor, which model is proposed and why, citing current pricing/capability/
> context-limit facts from the snapshot (§3), with its freshness visible. `Agent`
> registry/`AgentRun` cost tracking (Slice 3) already handle consumption; the catalog + weekly
> fetch + recommendation logic are new."

This is the second-to-last slice of the 11-slice blueprint (11–21); Slice 21
(`configuration-center-generalization`) is the only one left after this and was explicitly set
aside for this proposal — see "Why" below.

## Why

Every AI-execution cost figure in the product today is a hardcoded constant
(`src/lib/agents/claudeExecutor.ts`'s `INPUT_COST_PER_TOKEN`/`OUTPUT_COST_PER_TOKEN`, and
`config/workflow.yaml`'s seeded agent model name) that silently goes stale the moment Anthropic
changes pricing or ships a new model — exactly what the user's Q1 clarification says this slice
must stop doing. Slice 17 already built the shared `AiRecommendationCard` pattern (What/Why/
Assumptions/Estimated time/Estimated cost/alternative/override) and used it for the AI-vs-developer
executor recommendation; §5.8 is the blueprint's own explicitly-designated second instance of that
same card — *which model* to use, and why — so building it now completes the pair rather than
leaving AI execution's cost basis ungrounded indefinitely.

Chosen as the next slice over Slice 21: Slice 21 (generalizing Configuration Center's existing
scope-inheritance + Preview→Confirm pattern to gates, evidence rules, test rules, branch/PR policy,
and source mapping) requires inventing what four of those five policy areas even *are* as product
concepts — none has any code, schema, or defined shape anywhere in this codebase today. That is a
real product decision, not an implementation detail, and per CLAUDE.md's "do not silently invent a
product decision" rule, is out of scope for this proposal to resolve unilaterally. Slice 20 has no
such blocker: its scheduling mechanism, external-fetch pattern, and recommendation-card UI all
already exist in the codebase in a form this slice extends rather than invents from scratch (see
design.md for the full grounding).

## What Changes

- New `ModelSnapshot` entity: one row per weekly fetch attempt, with a fetch timestamp, the raw
  fetched content (for debugging when extraction disagrees with what's visible on the page), a
  structured list of extracted models (name, pricing, context window, capabilities — exact field
  set decided in design.md), and a success/failure status so a failed extraction never silently
  presents fabricated data.
- New self-requeuing `JobType` (`FETCH_MODEL_SNAPSHOT`) that fetches
  `platform.claude.com/docs/en/about-claude/models/overview`, extracts a `ModelSnapshot`, and
  re-enqueues itself for next Sunday 07:00 — reusing the existing Job runtime's `scheduledAt`
  claim-gating (`Job.scheduledAt <= now()`), which needs only a new optional `scheduledAt`
  parameter on `enqueueJob`, not a new scheduling primitive.
- New `recommendModel` domain function: given a WorkItem being AI-executed, reads the latest
  successful `ModelSnapshot` plus the WorkItem's existing signals and proposes a model with
  reasoning, replacing `claudeExecutor.ts`'s hardcoded per-token cost constants as the source of
  truth for cost estimation once a snapshot exists (falling back to the existing hardcoded
  constants before the first successful weekly run, so cost estimation is never blocked on the job
  having run at least once).
- `AiRecommendationCard` (Slice 17) reused for the model-recommendation UI, shown on a WorkItem
  whose `executorType` is `AI_AGENT` — the counterpart to Slice 17's card, which shows only when
  `executorType` is `UNASSIGNED`.

**Explicitly out of scope for this slice** (see design.md for the full reasoning):
- An admin-facing manual "run now" trigger for the snapshot job — the weekly self-requeue alone
  satisfies this slice's scope; a manual trigger is a natural, separately-scoped follow-up.
- Actually switching which `Agent` row executes a drafting run based on the recommendation — this
  slice recommends and displays only; wiring the recommendation into `resolveStageAgentId`'s actual
  selection is a further behavior change with its own override-semantics questions, deferred.
- Extracting capabilities beyond pricing and context window (e.g. tool-use support, vision) if the
  source page's structure makes them meaningfully harder to extract reliably than pricing/context
  window are.

## Capabilities

### New Capabilities
- `ai-model-knowledge-snapshot`: the weekly fetch/extract job, the `ModelSnapshot` record it
  produces, and the `recommendModel` function that reads it to recommend a model with reasoning and
  visible freshness for an AI-executed WorkItem.

### Modified Capabilities
- `ai-recommendation`: extends the shared AI-recommendation card requirement to cover a second
  concrete instance (model selection, shown when `executorType === "AI_AGENT"`) alongside the
  existing AI-vs-developer executor instance, and updates the cost-estimate requirement to note
  that once a `ModelSnapshot` exists, it — not a hardcoded constant — is the grounding source for
  AI-execution cost estimates.

## Impact

- **Schema**: new `ModelSnapshot` model (Prisma migration); no changes to existing models.
- **Job runtime**: `enqueueJob` (`src/domain/job/commands.ts`) gains an optional `scheduledAt`
  parameter; `worker.ts`'s handler map gains a `FETCH_MODEL_SNAPSHOT` entry; `JobType` enum gains
  a new value.
- **`src/lib/agents/claudeExecutor.ts`**: its hardcoded cost constants become the fallback path,
  no longer the only path, once a `ModelSnapshot` exists.
- **New domain layer**: `src/domain/model-snapshot/` (or similar — finalized in design.md) for
  snapshot fetch/extraction/query commands and `recommendModel`.
- **UI**: `AiRecommendationCard` gains a second call site (on a WorkItem's Overview tab, gated on
  `executorType === "AI_AGENT"`, mirroring Slice 17's existing `UNASSIGNED`-gated call site); no
  new component.
- **New API route(s)**: to serve the model recommendation to `AiRecommendationCard`'s self-fetching
  pattern, mirroring Slice 17's `GET /api/work-items/[id]/recommendation`.
