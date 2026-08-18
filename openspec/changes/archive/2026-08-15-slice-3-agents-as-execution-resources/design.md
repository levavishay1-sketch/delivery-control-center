## Context

Today (post-Slice 2): `src/lib/agents/` exports one `AgentExecutor`
(`mockExecutor` or `claudeExecutor`, chosen by `getAgentExecutor()` off a
single `AI_MODEL`/API-key env check — global, not per-project/client/stage).
`draftStage`/`draftConstitution` enqueue a `Job` (`DRAFT_STAGE`/
`DRAFT_CONSTITUTION`); `worker.ts` claims it, calls the executor, and
`completeStageDraft`/`completeConstitutionDraft` write `aiModel`,
`promptTokens`, `completionTokens`, `costUsd` directly onto `Stage`/
`Constitution` (and, for `Stage`, additionally onto a `StageVersion` row —
Slice 2's append-only content history). `Job` already owns retry/backoff
(`attempts`/`maxAttempts`/`lastError`, exponential reschedule) and atomic
claiming. Nothing sums cost across drafts; nothing blocks further drafting
at any spend level. See proposal.md for the full "why."

## Goals / Non-Goals

**Goals:**
- Every drafting attempt-cycle (one `Job`, including its retries) produces
  exactly one inspectable `AgentRun` — surviving redrafts, not overwritten.
- A stage type can be routed to a specific configured `Agent`, fixed for a
  pipeline at start the same way `stageSequence` already is.
- AI cost is summable per work item/project/client and a budget can block
  further drafting until a human explicitly approves continuing.
- Raw run detail (structured error, full token breakdown) is visible only
  to write-capable roles.

**Non-Goals:**
- Multi-step/tool-using agent runs. `AgentRun.toolCalls` exists as a
  column because the source names it, but no executor in this codebase
  calls tools today (`claudeExecutor` is single-turn); it stays empty
  until something populates it. Not invented here.
- A general hierarchical (Organization → Client → Project → …) config
  system. Agent routing and budgets live in the same global
  `config/workflow.yaml` / a new `config/agents.yaml`-style file Slice 0–2
  already established as the config mechanism — not a new per-tenant
  config layer. That generalization is Slice 6's explicit job.
- A role hierarchy for "who can approve past a budget." Reuses the
  existing `WRITE_ROLES` check, no new ranking invented — same choice
  Slice 2 made for `approverRoles` rather than inventing role tiers.
- Retrying an individual model call more granularly than `Job` already
  does. `AgentRun` *records* the outcome of `Job`'s retry loop; it does
  not run a second, independent retry mechanism alongside it.

## Decisions

### 1. `AgentRun` granularity: one row per `Job` attempt-cycle, not per attempt
An `AgentRun` is created when a `DRAFT_STAGE`/`DRAFT_CONSTITUTION` job is
first claimed and finalized (status, token/cost, `retryCount`, structured
error) when that job reaches a terminal state (`SUCCEEDED` or exhausted
`FAILED`) — mirroring `Job.attempts` at that terminal point, not a
separate row per individual retry. A `Job`'s intermediate retries update
the same `AgentRun` row (`retryCount` incremented, `lastError` field
updated) rather than creating new ones.

**Alternative considered**: one `AgentRun` per individual attempt (so 3
retries = 3 rows). Rejected — the source names `retryCount` as a *field on
the run*, implying one run per logical attempt-cycle, and per-attempt rows
would duplicate what `Job`'s own `attempts` counter already tracks without
adding new information, just more rows to query through.

### 2. Migrating existing cost data: additive columns + a backfill, `Stage`/`Constitution` keep their columns as a cache
`Stage`, `Constitution`, and `StageVersion` gain a nullable `agentRunId`
FK. A migration backfills one `AgentRun` per existing `Stage`/
`Constitution` row that has drafting data (`aiModel IS NOT NULL`),
reconstructed from that row's own `aiModel`/`promptTokens`/
`completionTokens`/`costUsd` (status `SUCCEEDED`, `retryCount: 0` — no way
to recover historical retry counts, and zero is the correct "unknown,
assume clean" default per this project's additive-migration convention).
`Stage.aiModel`/etc. columns are **not dropped** — they remain, kept in
sync with the run's own values on every write, so every existing read site
(`pipelines/[id]/page.tsx`, cost display) keeps working unchanged; they
become a denormalized cache of "the latest successful run's values," not
the source of truth.

**Alternative considered**: drop `Stage`'s cost columns entirely, forcing
every read site to join through `AgentRun`. Rejected as unnecessary
churn — same reasoning Slice 2 used for `StageVersion` vs. `Stage.content`
(design.md Decision 5 there): keep the fast/simple "latest" read path,
add the history/detail alongside it.

### 3. Agent routing: keyed by `StageType`, snapshotted onto `Pipeline` at start
`config/workflow.yaml`'s per-stage entry gains an optional `agent: string`
key naming an `Agent` registry entry (new top-level `agents:` list in the
same file — no new config file, reusing the mechanism Slice 0–2 already
established). Unset means "use the default agent." Resolved once, at
`startPipeline`, into the pipeline's own snapshot (extending the existing
`stageSequence` snapshot mechanism, Slice 2 Decision 3) — not re-resolved
live on every draft — so editing the registry after a pipeline starts
never changes that pipeline's behavior, exactly mirroring the
already-established stage-sequence guarantee.

**Alternative considered**: route by work-item type or a new
technology/domain classification field (matching the source's own
illustrative examples, "React→Frontend Agent"). Rejected for this slice —
the domain model has no such field, and inventing one is a materially
larger, separate decision (schema + UI + sync-mapping for an entirely new
work-item dimension) than what "give each pipeline stage a configurable
agent" requires. Flagged explicitly in proposal.md, not silently chosen.

### 4. Budget enforcement: checked before enqueueing, not mid-job
`draftStage`/`draftConstitution` check the owning client's (or project's,
if a project-level budget is set — project overrides client) accrued
`AgentRun` cost against its configured budget *before* enqueueing the
`Job`, refusing with a `ConflictError` if already at or over budget. This
mirrors `startPipeline`'s existing "validate before creating state"
shape, and fails fast (no job ever sits `QUEUED` only to be refused later)
rather than needing the worker to re-check and abort mid-flight.

**Alternative considered**: check inside the worker's job handler, after
claiming. Rejected — a job the requester already got a "queued" response
for silently never running is a worse failure mode than the request being
refused up front, matching design.md's own AI-never-writes-authoritative-
state-directly spirit: refusal is itself a decision, made at the
synchronous request boundary, not buried in an async job's own logic.

### 5. "Explicit approval to continue" is a new `BudgetOverride` audit-logged action, not a config toggle
Approving past an exceeded budget is a `WRITE_ROLES`-gated command
(`approveBudgetOverride(ctx, clientId | projectId)`) that records an
`AuditEvent` and raises the effective threshold check for a bounded window
(the next single draft, not indefinitely) — a human re-approves each time
spend crosses the line again, rather than one approval silently disabling
the budget forever.

**Alternative considered**: let approval just bump the configured budget
number. Rejected — that's indistinguishable from someone quietly raising
their own limit with no record of *why*; a logged, per-crossing approval
keeps the audit trail meaningful the same way every other gate in this
system already does.

## Risks / Trade-offs

- **[Risk] Backfilling historical `AgentRun` rows loses real retry
  history** (every pre-migration draft becomes `retryCount: 0`) →
  **Mitigation**: explicitly accepted, documented in Decision 2 — the data
  was never captured, so this is a floor-raising migration, not a
  regression; no existing `Job.attempts` value is discarded either (it
  stays on the `Job` row, just not linked into the new `AgentRun` shape
  for pre-migration jobs).
- **[Risk] Per-stage-type `Agent` routing, snapshotted at pipeline start,
  adds a second snapshot alongside `stageSequence`** — a future
  maintainer could forget the second one when adding a new
  snapshot-sensitive config field → **Mitigation**: both live in the same
  `Pipeline` row (`stageSequence` and a new `agentRouting` JSON column),
  resolved in the same `startPipeline` transaction — one call site, not
  two independent mechanisms to keep in sync.
- **[Trade-off] Project-level budget overriding client-level, rather than
  the stricter of the two winning** — a project could raise its effective
  limit above its client's. Accepted: a project-level override is an
  explicit, visible configuration choice (not a bypass), and inventing a
  "strictest wins" precedence rule is exactly the kind of implied
  hierarchy Slice 6 owns generalizing properly later.
- **[Risk] `BudgetOverride`'s "next single draft" window is ambiguous for
  Constitution vs. Stage drafts running concurrently** → **Mitigation**:
  scope the override to the specific `clientId`/`projectId` it was granted
  for, consumed by whichever drafting request claims it first (an atomic
  `UPDATE ... WHERE consumed = false RETURNING`, same claim pattern
  `Job.claimJobs` already uses) — a second concurrent request past budget
  is refused normally and needs its own approval, not a shared grant two
  requests could both silently consume.

## Migration Plan

1. Additive schema migration: `Agent`, `AgentRun`, `BudgetOverride` models;
   `Pipeline` gains `agentRouting` (Json, nullable); `Stage`/
   `Constitution`/`StageVersion` gain nullable `agentRunId`.
2. Backfill migration: one `AgentRun` per existing drafted `Stage`/
   `Constitution` row (Decision 2), linking `agentRunId` back.
3. `config/workflow.yaml` gains `agents:` (registry) and each stage's
   optional `agent:` key; default agent matches today's env-driven
   executor choice exactly, so an un-migrated config behaves identically.
4. Ship `AgentRun` recording in the worker's job handlers and
   `startPipeline`'s `agentRouting` snapshot in the same commit — never a
   window where a drafted stage has no run recorded.
5. Ship budget checks and `approveBudgetOverride` after run recording
   exists (a budget with nothing summed yet is meaningless).
6. UI last: run detail, cost rollups, budget configuration.

No rollback path beyond standard migration-down + revert-the-commit, per
`docs/ROADMAP.md`'s protected invariants (migration history additive-only).
