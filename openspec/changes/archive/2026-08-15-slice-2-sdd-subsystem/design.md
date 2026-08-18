## Context

Today's pipeline mechanics (`src/domain/pipeline/commands.ts`,
`src/lib/config.ts`): `createPipeline` is called automatically from
`createWorkItem`, seeding a `Pipeline` with `currentStage` = the first
stage in `config/workflow.yaml` (currently `CONSTITUTION`). `draftStage`
sets the target `Stage` to `AI_DRAFTING`, calls
`getAgentExecutor().executeStage()` **synchronously inside the HTTP
request** (this already works and is real — Slice 0's
`real-ai-stage-drafting` change made `AI_DRAFTING` a genuinely observable
state, not a dead enum value; see the `PRODUCT_SPEC.md` correction this
session made), then writes the result and — if the stage doesn't require
approval — auto-advances the pipeline. `approveStage`/`rejectStage` are
gated by `requireClientRole(ctx, clientId, WRITE_ROLES)` uniformly, with
no per-stage-type distinction. `getNextStageType()` re-reads
`config/workflow.yaml` from disk on every call (cached only in
production) — there is no per-pipeline snapshot, so editing the file
changes the behavior of every pipeline currently in flight, including
ones already past the stage being edited. `WorkItem 1—0/1 Pipeline` is a
true 1:1 created automatically; `Constitution` does not exist as a
separate model — it's just the first `StageType`, drafted and versioned
per work item like every other stage (i.e., not versioned at all — a
redraft overwrites `Stage.content` in place).

`StageType` currently has 5 values (`CONSTITUTION`, `SPEC`, `PLAN`,
`TASKS`, `DEPLOY`); `StageStatus` has 6 (`PENDING`, `AI_DRAFTING`,
`PENDING_APPROVAL`, `APPROVED` — dead, never assigned — `REJECTED`,
`DONE`). Enum values are additive-only per `docs/ROADMAP.md`'s protected
invariants; nothing here removes `CONSTITUTION` from the enum, since
historical `Stage` rows reference it.

See `proposal.md` for the full "why" and the two decisions already made
there (build the job model now; `Implement` stays a drafted document, not
real code execution).

## Goals / Non-Goals

**Goals:**
- AI drafting survives a process crash or restart mid-call without losing
  the attempt or leaving a stage stuck in `AI_DRAFTING` forever.
- A paused Clarify question survives a process restart with zero special
  handling, because the pause itself is just a persisted row, not
  in-memory state.
- Editing `config/workflow.yaml` never changes the stage sequence or gate
  behavior of a pipeline already created.
- Existing pipelines keep working exactly as they do today after this
  ships — no reinterpretation of history under the new default stage list.

**Non-Goals:**
- A general-purpose job queue for arbitrary background work (Jira sync,
  future connector syncs) — this slice's `Job` table is shaped generally
  enough to extend later (Slice 4), but only `DRAFT_STAGE` and
  `DRAFT_CONSTITUTION` jobs are implemented now (Constitution drafting is a
  real AI call subject to the same crash-durability goal as Stage drafting —
  see Decision 4a).
- Redis/BullMQ or any queue infrastructure beyond Postgres — the source
  document explicitly defers this until there's a measured need.
- An `Agent` registry with configurable per-work-item-type routing — one
  global `AgentExecutor` selection remains, as today (Slice 3 scope).
- Real code generation/execution for the `Implement` stage (settled in
  proposal.md — stays AI-drafted Markdown, mechanically identical to
  today's `Deploy`).
- Per-project or per-client stage-list configuration (still one global
  `config/workflow.yaml`) — Slice 6's hierarchical config scope. "Stage
  list becomes configurable" is satisfied by it being editable in one
  file and snapshotted per pipeline, not by per-project overrides.
- Multi-approver/quorum gates, or a formal role hierarchy/ranking — each
  stage names an explicit set of allowed roles, no implied ordering.
- A UI for dismissing/overriding a Critical Analyze finding — a Critical
  finding is cleared only by redrafting the stage it's attached to.

## Decisions

### 1. `Job` table + a separate poll-based worker process, not an in-request queue
A `Job` row: `id`, `type` (`DRAFT_STAGE` for now), `payload` (JSON),
`status` (`QUEUED`/`RUNNING`/`SUCCEEDED`/`FAILED`), `attempts`,
`maxAttempts`, `lastError`, `scheduledAt`, `lockedAt`, `lockedBy`,
`idempotencyKey` (unique — `draftStage` reuses the same key for a given
stage+attempt so a duplicate enqueue is a no-op), `createdAt`,
`updatedAt`. A worker (`worker.ts`, run as `npm run worker` in dev; a
second process alongside `next start` in any real deployment) polls on an
interval, claims a batch via `UPDATE ... SET status='RUNNING', lockedAt=now(), lockedBy=$id
WHERE status='QUEUED' AND scheduledAt <= now() ORDER BY scheduledAt LIMIT N
RETURNING *` (atomic claim, no separate lock table), runs the job, and on
failure increments `attempts`, sets `lastError`, and reschedules
`scheduledAt` with exponential backoff — until `maxAttempts` is hit, at
which point the job (and the stage it was drafting) moves to a terminal
failure state a human must act on.

**Alternative considered**: run jobs from a Next.js route handler polled
by an external cron, per the source document's other suggested shape.
Rejected for now — this environment has no deployment/cron infrastructure
yet (`PRODUCT_SPEC.md` §18/§30), and a standalone `worker.ts` is strictly
simpler to run locally (`npm run worker` next to `npm run dev`) with an
equally trivial path to a cron-triggered HTTP endpoint later if a
deployment target requires it — the job-claim SQL doesn't change either
way.

**Alternative considered**: keep drafting synchronous-in-request as
today, only adding retry-around-the-call. Rejected — this satisfies retry
but not "survives a process restart," since an in-flight `await` is lost
entirely if the process dies mid-call; the explicit slice goal is
restart-durability, not just retry.

### 2. The pause *is* the durable state; the `Job` only covers the active AI call
A Clarify pause needs no special "resume" machinery beyond what already
exists: the stage sits in a new `AWAITING_CLARIFICATION` status
(`StageStatus` gains this value) with one or more `ClarifyQuestion` rows
(`stageId`, `question`, `answer` nullable, `answeredByUserId`,
`answeredAt`). Nothing is "running" while paused — a process restart has
nothing to lose. Answering the last outstanding question for a stage
re-enqueues a `DRAFT_STAGE` job with the answers folded into the executor
context, moving the stage back to `AI_DRAFTING`. Only the network-call
portion (the few seconds an actual Claude/mock call takes) needs the
`Job` table's crash-durability; the wait-for-a-human portion is durable
for free because it's just a database row.

### 3. Stage sequence is snapshotted onto `Pipeline` at creation
`Pipeline` gains `stageSequence: StageType[]` (Postgres array column),
copied from `loadWorkflow()`'s current stage list at the moment
`startPipeline` runs. `getNextStageType()` and `getFirstStageType()`
become pipeline-scoped: they read `pipeline.stageSequence`, not the live
config file. A migration backfills every existing `Pipeline` row's
`stageSequence` to `['CONSTITUTION','SPEC','PLAN','TASKS','DEPLOY']` — the
list they actually started under — so no existing pipeline's behavior
changes. `config/workflow.yaml`'s default becomes
`SPEC → CLARIFY → PLAN → TASKS → ANALYZE → IMPLEMENT → DEPLOY`; only
pipelines created after this ships pick it up.

### 4. Constitution becomes its own model, referenced (not duplicated) by pipelines
New `Constitution` model: `id`, `projectId`, `version` (int, starts at 1,
incremented on redraft — never overwritten in place, satisfying
"versioned artifacts" for this one directly since it has no per-work-item
`Stage` row at all), `content`, `status`
(`DRAFT`/`PENDING_APPROVAL`/`APPROVED`/`REJECTED`, mirroring
`StageStatus`'s shape but a separate enum since a Constitution isn't a
`Stage`), `aiModel`/`promptTokens`/`completionTokens`/`costUsd` (same
drafting-cost fields `Stage` has), `createdAt`, `approvedAt`. `Pipeline`
gains `constitutionVersion: Int?` — the version it ran under, set when
`startPipeline` runs (requires an `APPROVED` Constitution to exist for
the project; `startPipeline` fails with a clear error otherwise, pointing
at drafting one). `CONSTITUTION` stays in `StageType` for historical
`Stage` rows but is never used by a `stageSequence` created after this
ships.

**Alternative considered**: version `Constitution` the same way stage
content is versioned generally (see #5) via a shared
`VersionedArtifact` polymorphic table. Rejected — a `Constitution` is
project-scoped with its own approval gate and no `Pipeline`/`Stage`
relationship at all; forcing it through the `Stage`-versioning shape
would need a nullable `stageId` and a parallel `projectId`/`constitutionId`
path on the same table, more complex than two small, independently
understandable models.

### 4a. Constitution drafting is job-backed via its own `DRAFT_CONSTITUTION` job type, run through a new `executeConstitution` on `AgentExecutor`
`ConstitutionStatus` gains `AI_DRAFTING` (mirroring `StageStatus`).
`draftConstitution(ctx, projectId)` enqueues a `DRAFT_CONSTITUTION` job
(`{ constitutionId }` payload) and returns immediately, exactly like
`draftStage` does for `DRAFT_STAGE` (Decision 1/Task Group 5) — the same
`enqueueJob`/`claimJobs`/`completeJob`/`failJob` primitives, a second entry
in `worker.ts`'s dispatch table. `AgentExecutor` gains
`executeConstitution(context: ConstitutionExecutionContext):
Promise<StageExecutionResult>` alongside `executeStage`, because a
`Constitution` is project-scoped (`projectName`/`projectKey`), not
work-item-scoped — `StageExecutionContext`'s shape (`workItemTitle`,
`workItemSource`, ...) doesn't fit. `config/prompts/constitution.md` moves
from work-item placeholders (`{{title}}`, `{{source}}`) to project ones
(`{{projectName}}`, `{{projectKey}}`), and is loaded directly by
filename rather than through `getStageConfig("CONSTITUTION")` — once
Task Group 4 drops `CONSTITUTION` from `config/workflow.yaml`'s stage
list, that lookup would 404.

**Draft-vs-new-version policy** (Task 3.1's open question): drafting is
allowed only when no `Constitution` exists yet for the project (creates
version 1), the latest version's status is `DRAFT` (not yet submitted —
reused in place, no new row), or the latest is `REJECTED`/`APPROVED` (both
draft into a **new** version rather than overwriting — rejected content
stays retrievable as history, and an approved version can still be
superseded later without losing it; `getApprovedConstitution` just picks
the newest `APPROVED` row by version, so an older approved row doesn't
need active un-approval). Drafting is refused only while the latest is
`PENDING_APPROVAL` or `AI_DRAFTING` — a submission already in flight or
awaiting a decision, where a silent overwrite could change content a
reviewer is currently looking at.

**Alternative considered**: fold `executeConstitution` into `executeStage`
by keeping `StageType.CONSTITUTION` as the discriminator and stretching
`StageExecutionContext` with optional project fields. Rejected — Decision
4 already made `Constitution` its own model specifically to stop treating
it as a `Stage`; reusing `executeStage`'s work-item-shaped context for a
project-scoped artifact would reintroduce the coupling that decision
removed, for both callers and the two executor implementations.

### 5. Stage content versioning: an append-only `StageVersion` child table
`Stage` keeps its current columns (`content`, `aiModel`, token/cost
fields) as **the latest version**, unchanged, so every existing query that
reads `stage.content` keeps working. A new `StageVersion` row (`stageId`,
`versionNumber`, `content`, `aiModel`, token/cost fields, `createdAt`,
`createdAsResultOf`: `DRAFT`/`REDRAFT`) is inserted every time
`draftStage`'s worker-side completion handler writes new content — *in
addition to* updating `Stage`'s own columns, inside the same transaction.
`versionNumber` is `1 + count of existing StageVersion rows for this
stage`. The 360° Record and pipeline detail page can list
`stage.versions` for history; nothing that reads `stage.content` directly
needs to change.

**Alternative considered**: make `Stage.content` itself nullable and move
all content onto `StageVersion`, with `Stage` pointing at its
`currentVersionId`. Rejected as unnecessary churn — every existing read
site (`pipelines/[id]/page.tsx`, the mock/Claude executors reading
`previousStageContent`) already reads `stage.content` directly; keeping
that column as "latest" and adding history alongside is strictly
additive.

### 6. Role-based gate policy: an explicit role list per stage in config, not a hierarchy
`config/workflow.yaml`'s per-stage entry gains `approverRoles: Role[]`
(e.g. `[PROJECT_MANAGER, MANAGER]` for `SPEC`, `[TECH_LEAD, MANAGER]` for
`PLAN`), replacing the current uniform `requireClientRole(ctx, clientId,
WRITE_ROLES)` check in `approveStage`/`rejectStage` with
`requireClientRole(ctx, clientId, stageConfig.approverRoles)`. `MANAGER`
is included in every stage's list by convention (an org's overall
manager can always act), avoiding the need to invent a role-ranking
system Slice 0/1 never established. `requiresApproval: false` stages
(auto-completing) don't need `approverRoles` at all.

### 7. `startPipeline` replaces automatic creation; `WorkItem 1—0/1 Pipeline` cardinality is unchanged
`createWorkItem` stops calling `createPipeline`. A new
`startPipeline(ctx, workItemId)` domain command: validates the work
item has no existing pipeline (the unique constraint already enforces
this at the DB level; the command gives a clear domain error instead of
a raw constraint violation), validates the project has an `APPROVED`
Constitution, snapshots `stageSequence` (#3) and `constitutionVersion`
(#4), and creates the `Pipeline` exactly as `createPipeline` does today.
The relationship's cardinality doesn't change — a work item still has at
most one pipeline, ever — only *when* it's created does.

### 8. Analyze findings block advancement, not drafting
`AnalysisFinding`: `stageId` (the `ANALYZE` stage that produced it),
`severity` (`INFO`/`WARNING`/`MEDIUM`/`HIGH`/`CRITICAL`), `message`,
`relatedStageType` (which prior artifact the finding is about, e.g.
`PLAN`). Drafting the `ANALYZE` stage always succeeds and completes (it's
a read-only consistency check, not a gate itself) — but
`advancePipelinePastStage` refuses to advance past `ANALYZE` while any
attached finding has `severity=CRITICAL` and no corresponding redraft of
the flagged stage has happened since. A human resolves this by redrafting
the implicated stage (e.g. `PLAN`), which clears findings attached to the
now-superseded `ANALYZE` run and requires re-drafting `ANALYZE` itself
before `IMPLEMENT` can start.

## Risks / Trade-offs

- **[Risk] A standalone `worker.ts` process is one more thing to keep
  running** (today: `npm run dev` alone is sufficient for the whole app;
  after this: `npm run dev` + `npm run worker`) → **Mitigation**: document
  it prominently in `README.md` and this session's equivalent of a
  "gotcha" (`CLAUDE.md`'s Project lessons section); a stage stuck in
  `AI_DRAFTING`/`QUEUED` past a generous timeout is a visible, debuggable
  symptom (visible in the UI, not a silent failure), not data loss.
- **[Risk] `Job` claim races under concurrent workers** → **Mitigation**:
  the claim UPDATE is a single atomic statement (`WHERE status='QUEUED' ...
  RETURNING`), which Postgres serializes correctly without needing
  `SELECT ... FOR UPDATE SKIP LOCKED` explicitly (though that's a
  reasonable follow-up if throughput ever demands it — not needed at this
  scale).
- **[Risk] Backfilling `stageSequence` on existing `Pipeline` rows is a
  one-way migration** → **Mitigation**: it's an additive column with a
  deterministic backfill value (the pre-Slice-2 default list, which is
  the actual list every existing pipeline ran under) — reversible by
  dropping the column if ever needed, and doesn't touch `Stage` or
  `Approval` history at all.
- **[Trade-off] `approverRoles` as an explicit per-stage list, not a role
  hierarchy** — a future stage type needing "Tech Lead or higher" still
  has to spell out every qualifying role rather than say ">= TECH_LEAD."
  Accepted: inventing a role ranking is a bigger, cross-cutting decision
  than this slice's stated scope, and the source document's own example
  (`SPEC→Project Manager, Plan→Tech Lead, Implement→automatic`) doesn't
  require one.
- **[Risk] `AnalysisFinding`'s "redraft clears it" resolution model has no
  explicit dismiss/override** — a Critical finding the team judges to be
  a false positive has no path forward except redrafting the same content
  again → **Mitigation**: explicitly named as a Non-Goal; if this proves
  too rigid in practice, a dismiss action is a small, independently
  addable follow-up, not a redesign.

## Migration Plan

1. Additive schema migration: `Job`, `Constitution`, `StageVersion`,
   `ClarifyQuestion`, `AnalysisFinding` tables; `StageType` gains
   `CLARIFY`/`ANALYZE`/`IMPLEMENT`; `StageStatus` gains
   `AWAITING_CLARIFICATION`; `Pipeline` gains `stageSequence` and
   `constitutionVersion` (both nullable initially).
2. Backfill migration: set `stageSequence =
   ['CONSTITUTION','SPEC','PLAN','TASKS','DEPLOY']` on every existing
   `Pipeline` row; `constitutionVersion` stays `null` for existing rows
   (they predate the Constitution model entirely — never read for them).
3. Make `stageSequence` `NOT NULL` once backfilled (a second migration
   after confirming the backfill, not combined into one — keeps each
   migration independently reviewable and reversible).
4. Update `config/workflow.yaml` to the new default stage list and add
   `approverRoles` per stage; add `config/prompts/clarify.md` and
   `config/prompts/analyze.md`.
5. Ship `startPipeline` and remove the automatic call from
   `createWorkItem`, behind the same commit that adds the "Start SDD" UI
   action — never a window where pipelines stop being creatable at all.
6. Ship the worker (`worker.ts`) and switch `draftStage` from a
   synchronous executor call to job enqueue + worker pickup in the same
   commit — never a window where drafting silently does nothing.

No rollback path beyond standard migration-down + revert-the-commit; per
`docs/ROADMAP.md`'s protected invariants, migration history is additive
only, so a rollback within this slice's own development is a forward
migration correcting course, not a reset.
