# Tasks: Slice 2 — SDD as a Subsystem

## Overview

Makes the SDD pipeline durable (a persisted job model, surviving process
restarts), correct (redrafts see why they were rejected, config edits
don't retroactively change in-flight pipelines), and able to ask for help
instead of guessing (Clarify) or trusting unchecked artifacts (Analyze).
Adds project-scoped Constitution versioning, role-based gate policy, and
makes starting a pipeline an explicit action. Tasks are grouped into
logical units, each testable and committable independently, per this
project's change-sizing convention (see Slice 1's tasks.md for the
established pattern).

## Task Group 1: Data Model & Migrations (7 tasks)

- [x] 1.1 Add `Job` model: `id`, `type` (start with a `JobType` enum containing just `DRAFT_STAGE`), `payload` (Json), `status` (`JobStatus`: `QUEUED`/`RUNNING`/`SUCCEEDED`/`FAILED`), `attempts` (Int, default 0), `maxAttempts` (Int, default e.g. 5), `lastError` (String?), `scheduledAt` (DateTime, default now), `lockedAt`/`lockedBy` (nullable), `idempotencyKey` (String, unique), `createdAt`/`updatedAt`. Index on `(status, scheduledAt)` for the claim query.
- [x] 1.2 Add `Constitution` model: `id`, `projectId`, `version` (Int), `content` (String?), `status` (new `ConstitutionStatus` enum: `DRAFT`/`PENDING_APPROVAL`/`APPROVED`/`REJECTED`), `aiModel`/`promptTokens`/`completionTokens`/`costUsd` (mirroring `Stage`'s cost fields), `createdAt`, `approvedAt` (nullable). Unique on `(projectId, version)`.
- [x] 1.3 Add `StageVersion` model: `id`, `stageId`, `versionNumber` (Int), `content`, `aiModel`/`promptTokens`/`completionTokens`/`costUsd`, `createdAsResultOf` (new `StageVersionTrigger` enum: `DRAFT`/`REDRAFT`), `createdAt`. Unique on `(stageId, versionNumber)`.
- [x] 1.4 Add `ClarifyQuestion` model: `id`, `stageId`, `question`, `answer` (String?, nullable), `answeredByUserId` (nullable FK to User), `answeredAt` (nullable), `createdAt`.
- [x] 1.5 Add `AnalysisFinding` model: `id`, `stageId`, `severity` (new `FindingSeverity` enum: `INFO`/`WARNING`/`MEDIUM`/`HIGH`/`CRITICAL`), `message`, `relatedStageType` (`StageType`), `createdAt`.
- [x] 1.6 Extend existing enums/models: `StageType` gains `CLARIFY`, `ANALYZE`, `IMPLEMENT` (additive — `CONSTITUTION` stays for historical rows). `StageStatus` gains `AWAITING_CLARIFICATION`. `Pipeline` gains `stageSequence` (`StageType[]`, nullable initially) and `constitutionVersion` (Int?, nullable).
- [x] 1.7 Two-step migration: (a) additive migration adding everything above with `stageSequence` nullable; backfill every existing `Pipeline.stageSequence` to `['CONSTITUTION','SPEC','PLAN','TASKS','DEPLOY']` in the same migration's SQL (a data migration, not just schema). (b) separate follow-up migration making `stageSequence` `NOT NULL` once backfilled — two migrations, not one, so each is independently reviewable per design.md's Migration Plan. Run against real local Postgres; verify existing seeded pipeline data survives with correct `stageSequence`.

## Task Group 2: Job Runtime (5 tasks)

- [x] 2.1 `src/domain/job/commands.ts`: `enqueueJob(type, payload, idempotencyKey)` — insert with `status='QUEUED'`; if `idempotencyKey` already exists, return the existing job instead of erroring (enqueue is idempotent, per design.md).
- [x] 2.2 `claimJobs(workerId, batchSize)`: atomic `UPDATE ... SET status='RUNNING', lockedAt=now(), lockedBy=$workerId WHERE status='QUEUED' AND scheduledAt <= now() ORDER BY scheduledAt LIMIT $batchSize RETURNING *`. Tests: two concurrent claims never return overlapping job sets (simulate via two calls racing against the same seeded queued jobs).
- [x] 2.3 `completeJob(jobId)` / `failJob(jobId, error)`: on failure, if `attempts + 1 < maxAttempts`, increment `attempts`, set `lastError`, reschedule `scheduledAt` with exponential backoff (`status` back to `QUEUED`); otherwise set `status='FAILED'` permanently.
- [x] 2.4 `worker.ts` (project root, run via a new `npm run worker` script): polls `claimJobs` on an interval, dispatches by `type` (only `DRAFT_STAGE` for now — see Task Group 5), calls `completeJob`/`failJob`. Document the two-process dev setup (`npm run dev` + `npm run worker`) in `CLAUDE.md`'s Project lessons section.
- [x] 2.5 Tests: enqueue/claim/complete/fail lifecycle, idempotent re-enqueue, backoff scheduling math, exhausted-retries terminal state. Commit: "Implement job runtime: persisted queue, worker, retry with backoff"

## Task Group 3: Constitution Versioning (4 tasks)

- [x] 3.1 `src/domain/constitution/commands.ts`: `draftConstitution(ctx, projectId)` — enqueues a `DRAFT_CONSTITUTION` job via the job runtime (its own job type, worker handler, and `AgentExecutor.executeConstitution`, independent of Task Group 5's Stage-specific path — see design.md Decision 4a) and returns immediately. Draft-vs-new-version policy per Decision 4a: no existing Constitution -> version 1; latest is `DRAFT` -> reused in place; latest is `REJECTED`/`APPROVED` -> new version; latest is `PENDING_APPROVAL`/`AI_DRAFTING` -> refused (`ConflictError`). Zod-validates authorization (`WRITE_ROLES`).
- [x] 3.2 `approveConstitution(ctx, constitutionId)` / `rejectConstitution(ctx, constitutionId, comment?)` — same shape as `approveStage`/`rejectStage`, recording an audit event; approving sets `status='APPROVED'` and `approvedAt`.
- [x] 3.3 `src/domain/constitution/queries.ts`: `getApprovedConstitution(projectId)`, `getConstitutionHistory(projectId)` (all versions, newest first).
- [x] 3.4 API routes: `POST /api/projects/[id]/constitution/draft`, `POST /api/constitutions/[id]/approve`, `POST /api/constitutions/[id]/reject`. Tests: version increments on redraft (never overwrites), `getApprovedConstitution` returns the latest `APPROVED` version only. Commit: "Implement project-scoped Constitution versioning"

## Task Group 4: Pipeline Optional Start (4 tasks)

- [x] 4.1 Remove the automatic `createPipeline` call from `createWorkItem` (`src/domain/work-item/commands.ts`).
- [x] 4.2 `src/domain/pipeline/commands.ts`: `startPipeline(ctx, workItemId)` — validates no existing pipeline (clear domain error, not a raw unique-constraint violation), validates the project has an `APPROVED` Constitution (`ValidationError` pointing at drafting one if not), snapshots `stageSequence` from `loadWorkflow()` and `constitutionVersion` from `getApprovedConstitution()`, creates the `Pipeline` + first stage, records the audit event — same transactional shape as today's `createPipeline`.
- [x] 4.3 Update `getNextStageType`/`getFirstStageType` equivalents to read from `pipeline.stageSequence` instead of the live config file (`src/lib/config.ts` callers move to pipeline-scoped lookups; keep `loadWorkflow()` itself for the snapshot-at-creation read).
- [x] 4.4 API route: `POST /api/work-items/[id]/pipeline` (start). UI: a "Start SDD" button where a work item has no pipeline (360° Record Overview tab, and the project work-item list). Tests: work item created with no pipeline; starting one without an approved Constitution is rejected; starting a second pipeline for the same work item is rejected; editing `workflow.yaml` after start doesn't change an existing pipeline's `stageSequence`. Commit: "Make pipeline start an explicit action; snapshot stage sequence"

## Task Group 5: Job-Backed Drafting & Stage Versioning (5 tasks)

- [ ] 5.1 Rework `draftStage`: validate + set `AI_DRAFTING` (or `AWAITING_CLARIFICATION` transition target — see Task Group 6) synchronously as today, but replace the synchronous `getAgentExecutor().executeStage()` call with `enqueueJob('DRAFT_STAGE', { stageId }, idempotencyKey)` and return immediately.
- [ ] 5.2 Worker-side `DRAFT_STAGE` handler: performs the actual `getAgentExecutor().executeStage()` call (moved from the old synchronous path), then the existing completion transaction (write content, `PENDING_APPROVAL`/`DONE`, auto-advance if `requiresApproval=false`) — plus, in the same transaction, insert a `StageVersion` row (Task Group 1.3) recording this draft's content before/alongside updating `Stage`'s own columns.
- [ ] 5.3 On executor failure inside the job: let `failJob` handle retry/backoff (Task Group 2.3); on final exhaustion, revert the stage out of `AI_DRAFTING` to a state a human can see and act on (reuse `REJECTED` with a system-authored audit event explaining the failure, rather than inventing a new status — document this choice).
- [ ] 5.4 UI: `DraftButton` no longer awaits a synchronous result; poll the stage's status (new lightweight `GET /api/stages/[id]` route) every few seconds while `AI_DRAFTING`/`QUEUED`, then `router.refresh()` once it leaves that state.
- [ ] 5.5 Tests: drafting enqueues a job and returns promptly (mock the executor with an artificial delay to prove the request doesn't wait); worker processing completes the stage exactly as the old synchronous path did; a `StageVersion` row exists after every draft; a failed-and-exhausted job leaves the stage in a visibly-failed state, not stuck. E2E: full draft-through-job round trip against the mock executor and worker running in the test process. Commit: "Move stage drafting onto the job runtime; version stage content"

## Task Group 6: Clarify Stage (5 tasks)

- [ ] 6.1 `config/prompts/clarify.md` prompt template. Extend `AgentExecutor`'s `StageExecutionResult` (or add a distinct result type) so a `CLARIFY` draft can return either normal content or a list of clarification questions — Zod-schema-validated structured output per design.md/proposal.md's "AI never writes authoritative state directly" constraint, not `JSON.parse`d ad hoc.
- [ ] 6.2 Worker-side `DRAFT_STAGE` handling for `CLARIFY`: if the executor result includes questions, insert `ClarifyQuestion` rows and set the stage to `AWAITING_CLARIFICATION` instead of `PENDING_APPROVAL`/`DONE`; if no questions, complete normally like any other stage.
- [ ] 6.3 `src/domain/clarify/commands.ts`: `answerClarifyQuestion(ctx, questionId, answer)` — sets `answer`/`answeredByUserId`/`answeredAt`; if this was the last unanswered question for its stage, re-enqueue a `DRAFT_STAGE` job with the answers folded into context, transitioning the stage back to `AI_DRAFTING`.
- [ ] 6.4 API route: `POST /api/clarify-questions/[id]/answer`. UI: an awaiting-clarification panel on the pipeline detail page showing outstanding questions and an answer form; consider Attention-Center visibility for a paused Clarify stage (Slice 1's existing groups don't cover this — decide whether to reuse `Decision`-shaped visibility or add a query to `attention/queries.ts`; document the choice, don't silently skip it).
- [ ] 6.5 Tests: a question pauses the stage; answering all questions resumes drafting with them in context; answering one of two leaves the stage paused; simulate a process restart (re-fetch from DB mid-pause) and confirm the paused state and questions are unchanged. Commit: "Implement the Clarify stage: pause, ask, resume"

## Task Group 7: Analyze Stage (4 tasks)

- [ ] 7.1 `config/prompts/analyze.md` prompt template; structured, schema-validated findings output (severity + message + related stage type) from the executor, same "AI output → schema → domain command" discipline as Clarify.
- [ ] 7.2 Worker-side `DRAFT_STAGE` handling for `ANALYZE`: always completes (read-only check, not itself a gate); inserts `AnalysisFinding` rows from the structured output.
- [ ] 7.3 `advancePipelinePastStage`: refuse to advance past an `ANALYZE` stage while any finding from its most recent run has `severity=CRITICAL`. Redrafting the stage a Critical finding names (`relatedStageType`) followed by a fresh `ANALYZE` draft is required to proceed — document/implement how a fresh `ANALYZE` run supersedes the prior findings (e.g. only the latest `ANALYZE` stage's `StageVersion`'s findings count, per design.md's resolution model).
- [ ] 7.4 API/UI: findings panel on the pipeline detail page, grouped by severity, naming the related stage. Tests: findings recorded from a drafted Analyze stage; approving Analyze with a Critical finding present does not advance the pipeline; redrafting the flagged stage and re-running Analyze clean allows advancement. Commit: "Implement the Analyze stage: consistency findings, Critical blocks advancement"

## Task Group 8: Role-Based Gate Policy (3 tasks)

- [ ] 8.1 `config/workflow.yaml`: add `approverRoles: Role[]` per stage entry (per design.md's decision 6 — an explicit list per stage, `MANAGER` included in every list by convention, no role hierarchy invented). Update `WorkflowStageConfig`/`loadWorkflow()`'s type and parsing (`src/lib/config.ts`).
- [ ] 8.2 `approveStage`/`rejectStage` (`src/domain/pipeline/commands.ts`): replace the uniform `requireClientRole(ctx, clientId, WRITE_ROLES)` with `requireClientRole(ctx, clientId, stageConfig.approverRoles)`, reading the stage's config from the pipeline's own snapshot mechanism (Task Group 4.3), not the live file.
- [ ] 8.3 Tests: a role listed for a stage type can approve it; a write-capable role NOT listed for that specific stage type is refused (even though it would pass today's uniform check); a role permitted for one stage type is refused on a different stage type whose list doesn't include it. Commit: "Add role-based, per-stage-type gate policy"

## Task Group 9: Redraft Feedback (2 tasks)

- [ ] 9.1 Extend the drafting job's context-building step (wherever `previousStageContent` is assembled today) to also include: the most recent `Approval` row's `comment` for this stage if it was a rejection, and any `ClarifyQuestion`/`answer` pairs recorded during this run — passed to `getAgentExecutor().executeStage()` as additional context fields.
- [ ] 9.2 Update `mockExecutor.ts` and `claudeExecutor.ts` (and the `StageExecutionContext` interface) to accept and use the new context fields. Tests: a redraft's recorded context includes the prior rejection comment; a mock-executor test asserts the comment reaches the "prompt" the mock fills from. Commit: "Feed rejection comments and clarification answers into redrafts"

## Task Group 10: Pipeline Detail Page & Constitution UI (3 tasks)

- [ ] 10.1 Constitution UI: a project-level page or section (new route, e.g. `/projects/[id]/constitution`) to draft/approve/reject and view version history — the first UI surface for a capability that isn't per-work-item.
- [ ] 10.2 Pipeline detail page (`/pipelines/[id]`): stage version history (expandable, from `StageVersion`), the Clarify Q&A panel (Task Group 6.4), the Analyze findings panel (Task Group 7.4), role-based gate messaging (show which roles can act when the current user cannot), the "Start SDD" entry point (Task Group 4.4) for work items with no pipeline yet.
- [ ] 10.3 Responsive/accessible pass on all new UI (matches Slice 1's established bar): semantic sections, `aria-label`s on interactive elements, keyboard navigation on the version-history expand/collapse and Q&A form. Commit: "Build Constitution and enriched pipeline-detail UI"

## Task Group 11: End-to-End Test Scenario (1 task)

- [ ] 11.1 Playwright E2E: draft and approve a project Constitution → start a pipeline → draft SPEC → draft Clarify and answer a question (using a mock-executor path engineered to ask one) → draft Plan and Tasks → draft Analyze with a seeded Critical finding → verify advancement is blocked → redraft the flagged stage → re-run Analyze clean → verify advancement → draft Implement → approve through to pipeline completion → verify the full audit trail and stage version history reflect every step. No console errors.

## Task Group 12: Unit Tests for Domain Logic (2 tasks)

- [ ] 12.1 Vitest integration tests (real local Postgres, per this project's established pattern) for every new domain module not already covered inline in its own task group: `job`, `constitution`, `clarify`, cross-cutting `pipeline` changes (`startPipeline`, role-based gates, redraft feedback, stage versioning) not already exercised by Task Groups 2–9's own test tasks.
- [ ] 12.2 Confirm no regression in existing Slice 0/1 domain tests (`npm test` full suite) — the automatic-pipeline-creation removal (Task Group 4.1) and `createPipeline`→`startPipeline` rename touch `work-item/commands.test.ts` and any other test relying on the old auto-creation behavior; update those call sites, don't leave them silently broken. Commit: "Add comprehensive unit tests for Slice 2 domain logic"

## Task Group 13: Documentation & Verification (1 task)

- [ ] 13.1 Update `docs/PRODUCT_SPEC.md` to reflect Slice 2 (job runtime, Constitution versioning, Clarify/Analyze stages, role-based gates, optional pipeline start, versioned stage content, redraft feedback). Update `docs/ROADMAP.md`'s gap register (items #20–26 and the relevant AI-execution items #29/#32 this slice partially addresses) and move Slice 2's row to Done, linked to the archived change. Verify no dead code/unused imports (`npm run lint`, `npx tsc --noEmit`). Full verification: `npm run build`, `npm run lint`, `npm test`, `npx playwright test`, `openspec validate --specs`. Archive this OpenSpec change per `docs/ROADMAP.md`'s own stated process, syncing its delta specs into `openspec/specs/`.

---

## Verification Checklist (End-to-End)

Before marking Slice 2 complete:

- [ ] All migrations run without errors; no data loss; existing pipelines' `stageSequence` correctly backfilled.
- [ ] A process restart mid-draft does not lose the drafting attempt (job survives; worker or a replacement picks it up).
- [ ] A process restart mid-Clarify-pause loses nothing (verified directly, not just asserted).
- [ ] Editing `config/workflow.yaml` after a pipeline starts never changes that pipeline's behavior.
- [ ] A Critical Analyze finding genuinely blocks advancement; clearing it requires a real redraft, not a bypass.
- [ ] Role-based gates are enforced per stage type, not uniformly.
- [ ] Rejection comments and clarification answers are demonstrably present in a redraft's context (not just "wired," verified against a captured mock-executor call).
- [ ] Constitution versions accumulate; never overwritten in place.
- [ ] All Slice 0/1 functionality (tenancy, delivery model, Attention Center, Quick View, 360° Record, audit trail, dependency graph) continues to work — full existing test suite passes.
- [ ] Build succeeds (`npm run build`); lint passes; `tsc --noEmit` clean.
- [ ] E2E scenario passes against the real dev server and real Postgres, with the worker process actually running (not mocked away).
- [ ] `PRODUCT_SPEC.md` and `docs/ROADMAP.md` updated; change archived; specs synced.
