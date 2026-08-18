## Context

See proposal.md - Why/What Changes for motivation and scope. Relevant current state this design
builds on:

- `Job.scheduledAt DateTime` already exists with `@@index([status, scheduledAt])`, and `claimJobs`
  already filters `WHERE status='QUEUED' AND scheduledAt <= now()` — a future-dated job is already
  correctly held until due. `enqueueJob(type, payload, idempotencyKey, client?)` has no
  `scheduledAt` parameter today (always defaults to `now()`).
- `worker.ts` is a plain long-running Node process (`npm run worker`, separate from the Next.js
  request/response cycle) with a `handlers: Partial<Record<JobType, JobTypeHandlers>>` map and a
  `{ run, onExhausted? }` shape per job type; `onExhausted` fires once retries are exhausted
  (`Job.status` becomes `FAILED`) and today always *reverts* the underlying entity to an error
  state — no existing job type reschedules anything from `onExhausted`.
- `src/lib/integrations/github.ts` already calls Node's built-in `fetch()` directly from inside a
  `worker.ts` handler (`handleRunRepositoryDiscoveryJob`), proving plain `fetch()` works in this
  process without extra setup.
- `handleRunRepositoryDiscoveryJob` is the closest existing precedent for "fetch external content,
  then interpret it" — but it hands the fetched content to `AgentExecutor.executeRepositoryDiscovery`
  (an AI call, budget-checked, `AgentRun`-tracked). This slice's fetch job is different in kind: its
  entire purpose is to be the ground truth for AI cost estimation, so routing its own extraction
  through a priced AI call would be circular and would need its own budget/cost bookkeeping for no
  clear benefit — see Decision 2.
- `src/lib/agents/claudeExecutor.ts` hardcodes `MODEL`, `INPUT_COST_PER_TOKEN`,
  `OUTPUT_COST_PER_TOKEN`; `Agent.model` (Prisma) already stores a model string per `Agent` row;
  `resolveDefaultAgentId`/`resolveStageAgentId` (`src/domain/agent/commands.ts`) already resolve
  which `Agent` row executes a given stage, falling back to the `isDefault: true` row.
- Slice 17's `estimateExecutorCost` (`src/domain/agent/queries.ts`) already averages historical
  `AgentRun.costUsd`/duration with a type→type-only→global fallback ladder, and
  `AiRecommendationCard` already renders the shared card shape self-fetching from a `GET` route.

## Goals / Non-Goals

**Goals:**
- A weekly, self-sustaining fetch/extract job that survives worker restarts without a cron library.
- A model recommendation grounded in dated, real extracted facts, with a failure mode that is
  honest (visibly stale or absent) rather than fabricated.
- Reuse of the existing `AiRecommendationCard` shape and `estimateExecutorCost` cost-averaging
  machinery rather than inventing a second estimate algorithm.

**Non-Goals** (see proposal.md for the full list; design-level additions below):
- Cross-model comparison/scoring ("is Opus or Sonnet objectively better for this WorkItem type") —
  the product has exactly one configurable default `Agent`/model today, and no defined product
  factors for weighing cost vs. capability vs. quality across models exist anywhere in the
  blueprint beyond "which model is proposed and why." Inventing such a scoring system would be a
  real product decision this proposal has no basis to make unilaterally. See Decision 5.
- Recomputing `AgentRun.costUsd` retroactively for past runs once a snapshot exists — only future
  estimates benefit from a snapshot; historical `AgentRun` rows keep whatever cost was recorded at
  run time.
- A generic "fetch + extract structured content from any URL" utility — this slice's parser is
  scoped to this one source page's shape, matching how `src/lib/integrations/` already has each
  adapter hand-roll its own fetch logic rather than sharing one generic fetcher.

## Decisions

**1. Self-requeue via `enqueueJob`'s new optional `scheduledAt`, not a cron library.**
Add `scheduledAt?: Date` to `enqueueJob`; when provided, `Job.scheduledAt` is set to it instead of
defaulting to `now()`. On every attempt's completion — success, a recorded extraction failure, *or*
retry exhaustion (Decision 4) — the handler computes next Sunday 07:00 (UTC, matching every other
timestamp in this codebase) and calls `enqueueJob("FETCH_MODEL_SNAPSHOT", {}, weekKey, ...)` where
`weekKey` (e.g. `model-snapshot-${nextSunday.toISOString().slice(0, 10)}`) is the idempotency key —
unique per target week, so a duplicate call for the same week (e.g. two workers racing) is a no-op
via the existing idempotency-key uniqueness path, while each new week gets a fresh key.
*Alternative considered*: a `node-cron`-style in-process scheduler running inside `worker.ts`.
Rejected — it wouldn't survive a worker restart between fetches (the existing `Job` table already
gives durability across restarts for free; a separate in-memory scheduler would not), and would be
new execution infrastructure the source material explicitly says to avoid ("reusing the existing
Job runtime — Slice 2 — no new execution infrastructure").

**2. Extraction is plain text-pattern scanning, not an AI call.**
The handler fetches the page with `fetch()`, strips HTML tags to reduce markup noise, and scans the
resulting text for model-id-shaped substrings (matching Claude's public naming, e.g.
`/claude-[a-z0-9.-]+/gi`), dollar amounts near "per million tokens"/"per 1M tokens" language, and
context-window figures (e.g. "200K tokens", "1M context"). A model entry is accepted into the
snapshot only if it has a recognized name plus at least one recognized pricing or context-window
fact (Zod-validated); the raw fetched text is always stored alongside the structured output for
debugging when extraction and the live page visibly disagree.
*Alternative considered*: reuse `AgentExecutor.executeRepositoryDiscovery`'s pattern — hand the
fetched content to an AI call that extracts structured JSON. Rejected per the Context note above:
this job's entire purpose is to be a trustworthy, independent source for AI cost figures: an AI
call to extract "what AI costs" is circular, adds its own budget/cost/`AgentRun` bookkeeping this
slice would otherwise need to invent, and per the proposal's own framing risks depending on exact
wire-format/JSON structure rather than degrading gracefully. Deterministic text scanning is
simpler, cheaper, and its failure mode (empty/partial match) is easier to reason about than an AI
call's failure mode (a confidently wrong extraction).

**3. Bootstrap via a worker-startup "ensure scheduled" check, not a seed script.**
`worker.ts`'s startup (before `pollLoop()`) calls a new `ensureModelSnapshotJobScheduled()`
domain command: if no `FETCH_MODEL_SNAPSHOT` job is currently `QUEUED` or `RUNNING`, enqueue one
for the next Sunday 07:00. This makes the weekly cadence self-healing across worker restarts and
fresh environments alike, without a one-time seed-script entry that a fresh `prisma migrate reset`
could silently skip.
*Alternative considered*: enqueue the first job from `prisma/seed.ts`. Rejected — seeding only runs
once at setup time; if the `Job` row is ever lost (e.g. a `migrate reset` in dev) the cadence would
silently stop with no self-recovery, whereas the startup check runs every time the worker process
starts.

**4. `onExhausted` still reschedules next week — deliberately different from every other job type.**
Every existing job type's `onExhausted` only reverts the underlying entity to an error state for a
human to retry manually. For this job, retry exhaustion (e.g. the source page is unreachable for a
whole day) must not silently end the weekly cadence — `handleFetchModelSnapshotExhausted` records a
`ModelSnapshot` with `status: FAILED` (reason: the exhaustion error) *and* enqueues next Sunday's
job, exactly like the success and extraction-failure paths. This is called out explicitly because
it is a deliberate divergence from this codebase's established `onExhausted` convention, made only
for this one self-requeuing job type — not a precedent for handling every future job type's
exhaustion this way.

**5. `recommendModel` confirms the currently-configured model with current facts; it does not pick among models.**
`recommendModel(ctx, workItemId)` resolves the `Agent` that would execute this WorkItem the same
way the pipeline already does (`resolveDefaultAgentId`, since no stage-specific routing exists at
the WorkItem level yet), looks up that `Agent.model` string in the latest successful
`ModelSnapshot`'s extracted models, and returns a recommendation that **confirms** the configured
model with the snapshot's current pricing/context-window facts and the snapshot's fetch date as
the "why." If the configured model is *not* found in the latest snapshot (a signal it may be
deprecated or renamed), the recommendation says so explicitly as a caveat rather than silently
proceeding as if nothing changed — this staleness-detection is this slice's actual value-add per
§5.8's "with its freshness visible," not a competing model suggestion. See Non-Goals above for why
cross-model comparison is out of scope.

**6. The cost estimate reuses `estimateExecutorCost`'s historical-average figure, not a new
snapshot-derived calculation.**
The model-recommendation card's estimated cost is the same `estimateExecutorCost(type, risk,
priority)` figure Slice 17 already computes from historical `AgentRun` data — this slice does not
compute a second, competing estimate from the snapshot's raw per-token price × a token-count
guess. The snapshot's pricing facts appear in the card's reasoning/assumptions text (grounding
*why* this model, in current terms) rather than replacing the estimate's actual number, keeping
exactly one cost-estimation algorithm in the product.

**7. New `ModelSnapshot` schema**: `id`, `fetchedAt DateTime`, `status` (`SUCCESS` | `FAILED`),
`rawContent String` (the stripped page text actually scanned, for debugging), `extractedModels
Json` (array of `{ modelId, pricingText?, contextWindowText?, capabilitiesText? }` — kept as
loosely-typed extracted text fragments rather than strictly-parsed numeric fields, since forcing a
strict numeric parse is exactly the kind of "depend on exact structure" fragility the source
material warns against; `recommendModel` reads these as display text, not as inputs to arithmetic),
`failureReason String?`. No relation to `WorkItem`/`Agent` — it is a standalone, dated fact table,
matching how `RepositoryDiscovery` (Slice 14) is also a standalone versioned record rather than a
mutated-in-place row.

**8. Domain module**: `src/domain/model-snapshot/` (`commands.ts`:
`recordModelSnapshotAttempt`, `ensureModelSnapshotJobScheduled`; `queries.ts`:
`getLatestSuccessfulModelSnapshot`, `recommendModel`), following this codebase's established
domain-layer-per-capability convention.

## Risks / Trade-offs

- [The source page's structure changes and extraction silently returns zero models] → Mitigated by
  Decision 2's minimum-fields-per-model validation (a model entry with no recognizable pricing or
  context-window fact is dropped) and Decision 7's `rawContent` retention: a human can compare what
  was actually scanned against the live page when a snapshot looks empty or wrong. The prior good
  snapshot is never overwritten by an empty/failed one (per the `ai-model-knowledge-snapshot` spec's
  "failed extraction never silently presents fabricated data" requirement).
- [Regex/text-pattern extraction is inherently fragile compared to a real structured feed] →
  Accepted trade-off, explicit in the source material itself ("scan for recognizable text patterns
  ... rather than depending on exact JSON structure, so it degrades gracefully"). No structured
  feed for this information exists publicly; this is the same class of trade-off
  `fetchRepositorySnapshot` (Slice 14) already accepts for GitHub content.
- [`onExhausted` rescheduling (Decision 4) is a new pattern other job types don't follow] →
  Contained to this one handler; documented explicitly here so a future job type doesn't copy it by
  assuming it's the norm.
- [Confirm-only model recommendation (Decision 5) may read as a weaker feature than "AI recommends
  the best model"] → Accepted: the alternative is inventing an unscoped cross-model scoring product
  decision. Full model comparison remains available as a clearly-separated future slice once the
  product defines what "better" means across models (cost vs. capability vs. quality weighting).

## Migration Plan

1. Prisma migration: add `ModelSnapshot` model (Decision 7) and its `status` enum. No changes to
   existing models/enums besides adding `FETCH_MODEL_SNAPSHOT` to `JobType`.
2. Add the optional `scheduledAt` parameter to `enqueueJob` — backward compatible; every existing
   caller is unaffected (parameter is optional, defaults preserve today's `now()` behavior).
3. Add `handleFetchModelSnapshotJob`/`handleFetchModelSnapshotExhausted` to `worker.ts`'s handler
   map, and the `ensureModelSnapshotJobScheduled()` startup call (Decision 3).
4. No backfill needed: before the first successful Sunday run, `recommendModel` and cost estimation
   fall back to the existing hardcoded constants, unaffected by this change until real data exists.
5. Rollback: dropping the `FETCH_MODEL_SNAPSHOT` handler registration and the startup call reverts
   to today's behavior (hardcoded constants only); the `ModelSnapshot` table can remain unused
   without affecting anything else, since nothing else references it.
