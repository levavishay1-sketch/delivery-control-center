## Roadmap Source

Implements `docs/ROADMAP.md`'s **Slice 2 — SDD as a subsystem** row, sourced
from `docs/roadmap-sources/2026-08-14-gap-analysis-full.md` §5 "Slice 2":

> - Constitution as a project-level versioned artifact.
> - **Clarify**: when information required for implementation is missing,
>   the run **stops**, creates a clarification question, surfaces it in the
>   Attention Center, waits for a human answer, stores the answer against
>   the artifact version, then resumes. AI must not silently guess. This is
>   explicitly called out as extremely important in the vision.
> - **Analyze**: consistency check across Constitution/SPEC/Plan/Tasks
>   producing findings with severity (Info/Warning/Medium/High/Critical).
>   Critical findings block implementation.
> - Versioned artifacts — stage content is no longer overwritten in place.
> - SDD run state machine that genuinely pauses and resumes across process
>   restarts (built on the Slice 0 job model).
> - Role-based, config-driven gate policy.
> - Rejection and clarification feedback flow into redrafts.

The same source's §3 "Conflicts between the two documents — resolved. Do
not re-litigate" adds concrete detail this proposal treats as settled,
not open for re-derivation:

> 1. **Constitution** is promoted out of the per-work-item pipeline into a
>    **project-scoped, versioned artifact**. A pipeline records which
>    constitution version it ran against.
> 2. **Stage list becomes configurable**; the default becomes
>    `SPEC → Clarify → Plan → Tasks → Analyze → Implement`, with `Deploy`
>    available as an optional final release gate. `Clarify` and `Analyze`
>    are new and required by the vision.
> 3. **Stage order is snapshotted onto the `Pipeline` at creation.** Editing
>    `workflow.yaml` must never alter a run already in flight.
> 4. **A pipeline is optional and explicitly started.** Work items exist
>    independently; "Start SDD" is a user action. Existing 1:1
>    auto-creation is removed (migrate existing rows, don't drop them).
> 5. **Rejection feedback must reach the redraft.** Pass the rejection
>    comment (and clarification answers) into the redraft context.
> 6. **`requiresApproval` must actually work** (done in Slice 0), and gate
>    policy becomes role-based (e.g. SPEC→Project Manager, Plan→Tech Lead,
>    Implement→automatic once prior gates pass).

And §2.2, on the durable job model this slice's run state machine is
"built on":

> **2.2 Make long-running work asynchronous and durable.** AI drafting
> currently blocks an HTTP request and leaves nothing behind on failure.
> Replace with a persisted job model: a `Job` table (type, payload, status,
> attempts, lastError, scheduledAt, lockedAt, idempotencyKey) and a worker
> loop. Start with a Postgres-backed queue... Jobs are **idempotent** and
> **retried with exponential backoff**.

**Two decisions made explicitly for this proposal, recorded here rather
than left implicit**: (1) the "Slice 0 job model" the source assumes as a
foundation does not exist — Slice 0's tasks.md deviation note 6.2
explicitly deferred it, writing "a full `Job` table stays deferred,
consistent with design.md's note that the richer durable-pause/resume
state machine is Slice 2's job." Building it is therefore in scope *here*,
not an extension of prior work. (2) "Implement (real code)" in the
resolved-conflicts excerpt above stays an AI-drafted document in this
slice, mechanically identical to today's `DEPLOY` stage — real
code-generation/file-write capability is Slice 5's stated scope
("Engineering evidence... trace work item → code change"), and building it
here would duplicate that slice's entities ahead of its own plan.

## Why

The product's "engine room" — the Constitution→SPEC→Plan→Tasks→Deploy
pipeline — is real but shallow: every stage redraft blocks an HTTP request
with no persisted state (a Claude timeout or process restart loses the
attempt entirely and leaves no trace); a rejected stage silently re-runs
the *identical* prompt, so a human's rejection comment has zero effect on
the redraft; there is no way for the AI to say "I don't have enough
information" and pause for a human answer — it must guess or ship whatever
it drafted; there is no consistency check between a work item's own
Constitution, SPEC, Plan, and Tasks artifacts before they're treated as
authoritative; gates are uniformly "any write-capable role can approve
anything," with no way to require a Tech Lead specifically for a Plan gate;
and every work item gets a pipeline whether or not it needs one, including
one-line bug fixes that will never go through five stages of documentation.

Slice 1 built the delivery model and attention layer *around* the
pipeline. This slice makes the pipeline itself durable, correct, and
actually able to ask for help instead of guessing — the vision's own
stated top priority ("AI must not silently guess").

## What Changes

- New `Job` table and a Postgres-backed worker loop: AI drafting moves off
  the synchronous request path onto a durable, retried-with-backoff,
  idempotent job. `StageStatus.AI_DRAFTING` becomes a real, observable
  in-flight state instead of a dead enum value assigned and resolved
  within one request.
- `Constitution` becomes a project-scoped, versioned artifact — drafted
  and approved once per project (not per work item), with each `Pipeline`
  recording which version it ran under.
- New `CLARIFY` stage type: when the AI executor determines it lacks
  information required to draft the next stage, the run pauses, a
  structured clarification question is created and surfaced to a human,
  and the run resumes with the answer once given — the run must survive a
  process restart while paused.
- New `ANALYZE` stage type: runs a consistency check across a work item's
  Constitution/SPEC/Plan/Tasks artifacts, producing severity-rated
  findings (Info/Warning/Medium/High/Critical); a Critical finding blocks
  advancing to Implement until resolved.
- Stage content becomes versioned — a redraft creates a new version
  instead of overwriting the prior one in place; every version stays
  visible and auditable.
- **BREAKING**: the default stage list changes from
  `CONSTITUTION → SPEC → PLAN → TASKS → DEPLOY` to
  `SPEC → CLARIFY → PLAN → TASKS → ANALYZE → IMPLEMENT`, with `DEPLOY`
  available as an optional additional final gate. `config/workflow.yaml`'s
  shape changes accordingly. Existing in-flight pipelines are migrated
  onto a snapshot of the stage list they were created under (see below),
  not silently reinterpreted under the new default.
- Stage order is snapshotted onto the `Pipeline` at creation time instead
  of resolved dynamically on every transition — editing `workflow.yaml`
  no longer changes the behavior of a pipeline already in flight.
- **BREAKING**: pipeline creation becomes an explicit "Start SDD" user
  action instead of automatic on work-item creation. Existing 1:1
  auto-created pipelines are migrated forward (kept, not dropped) so no
  history is lost.
- A rejected stage's rejection comment, and any clarification answers
  given during the run, are passed into the redraft's prompt context —
  today's redraft silently repeats the identical prompt.
- Gate policy becomes role-based and config-driven per stage type (e.g.
  SPEC requires Project Manager+, Plan requires Tech Lead+), replacing the
  current uniform "any write-capable role" check. `AgentExecutor`-driven
  outputs that change domain state (a clarification question, an analysis
  finding) are returned as schema-validated structured JSON, never
  freeform text parsed ad hoc, applied only through a domain command.

## Capabilities

### New Capabilities
- `job-runtime`: a persisted `Job` table and worker loop making long-running AI drafting durable, idempotent, and retried with backoff — the foundation the Clarify pause/resume state machine and future connector syncs (Slice 4) build on.
- `constitution-versioning`: Constitution promoted to a project-scoped, versioned artifact; pipelines reference the version they ran under instead of each work item drafting its own.
- `clarify-stage`: a pipeline stage that pauses a run, asks a structured question when the AI lacks information it needs, waits for a human answer (surviving a process restart while waiting), and resumes.
- `analyze-stage`: a pipeline stage that produces severity-rated consistency findings across a work item's prior-stage artifacts; a Critical finding blocks advancing to Implement.
- `role-based-gate-policy`: config-driven, per-stage-type role requirement for who may approve or reject that stage's gate, replacing the current uniform write-role check.
- `pipeline-optional-start`: pipeline creation becomes an explicit user action instead of automatic on work-item creation; existing auto-created pipelines are migrated forward.

### Modified Capabilities
- `sdd-pipeline`: stage list becomes configurable (default `SPEC → CLARIFY → PLAN → TASKS → ANALYZE → IMPLEMENT`, `DEPLOY` an optional additional gate), snapshotted onto the `Pipeline` at creation rather than resolved per-transition; stage content is versioned instead of overwritten; a redraft's prompt context includes the prior rejection comment and any clarification answers.

## Impact

- **Schema**: new `Job`, `Constitution`(+version), `ClarifyQuestion` (or
  equivalent), `AnalysisFinding` models; `Stage` content becomes versioned
  (either a new `StageVersion` child table or an append-only history
  column — design.md decides); `Pipeline` gains a snapshotted stage-list
  reference and becomes nullable/optional relative to `WorkItem`
  (currently `WorkItem 1—0/1 Pipeline`, unique — this relationship's
  creation trigger changes, not its cardinality).
- **Migration**: existing 1:1 auto-created pipelines and their stage
  history must migrate forward under the old (`CONSTITUTION`-first) stage
  list they actually ran under, not be silently reinterpreted under the
  new default — per the resolved-conflict's explicit instruction to
  "migrate existing rows, don't drop them."
- **Config**: `config/workflow.yaml`'s shape changes to carry the new
  default stage list and per-stage-type role requirements;
  `config/prompts/*.md` needs new templates for `CLARIFY` and `ANALYZE`.
  `src/lib/config.ts` and `getNextStageType()` change to read a
  pipeline-snapshotted stage list instead of the live config file.
  `requiresApproval`'s binary flag (fixed in Slice 0) is superseded by the
  new per-stage-type role requirement, not kept alongside it.
- **API**: `POST /api/work-items` no longer auto-creates a pipeline; a new
  "Start SDD" mutation is added. `POST /api/pipelines/[id]/advance` and the
  stage approve/reject routes gain role-based authorization per stage
  type. New routes for answering a clarification question and viewing
  analysis findings.
- **UI**: the pipeline detail page (`/pipelines/[id]`) gains version
  history per stage, a Clarify answer form, and an Analyze findings
  panel. The Attention Center (Slice 1) is a likely integration point for
  paused Clarify questions — design.md decides whether that reuses the
  existing `Decision` entity/UI or introduces a new group.
- **Domain layer**: new `src/domain/job/`, likely folded into
  `src/domain/pipeline/` for constitution/clarify/analyze rather than new
  top-level aggregates — design.md decides the boundary.
- **Protected invariants** (per `docs/ROADMAP.md`'s "What must be
  protected" list): `recordAuditEvent()` stays the only write path; the
  `AgentExecutor` interface is extended, not replaced, and the mock
  executor keeps working with no API key; Prisma migration history stays
  additive; the `src/domain/<aggregate>/` boundary (Zod → authorize →
  transaction → audit event → typed result) extends to every new
  aggregate this slice adds.
