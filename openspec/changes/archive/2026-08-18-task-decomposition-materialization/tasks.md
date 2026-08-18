## 1. Data model & migration

- [x] 1.1 Add `TaskDraft` model to `prisma/schema.prisma`: `id`, `stageId` (FK → `Stage`,
      cascade), `title`, `description` (nullable), `materializedWorkItemId` (nullable FK →
      `WorkItem`, `onDelete: SetNull`), `createdAt`.
- [x] 1.2 Add the reverse relations (`Stage.taskDrafts`, `WorkItem.materializedFromTaskDraft`)
      needed for the FKs above.
- [x] 1.3 Generate and run the migration; regenerate the Prisma client.

## 2. AI output schema & executor

- [x] 2.1 Add `taskDraftsSchema`/`TaskDraftItem` to `src/lib/agents/types.ts` (title required,
      description optional), mirroring `analysisFindingsSchema`/`AnalysisFindingDraft` exactly.
      Add `taskDrafts?: TaskDraftItem[]` to `StageExecutionResult`.
- [x] 2.2 `claudeExecutor.ts`: add a `TASK_DRAFTS_MARKER` (`<!-- TASK_DRAFTS -->`) and
      `parseTaskDrafts`, mirroring `parseAnalysisFindings`; branch `executeStage` on
      `stageType === "TASKS"` to call it and return `taskDrafts` alongside `content`.
- [x] 2.3 `mockExecutor.ts`: mirror the same branch, deriving plausible mock task drafts the same
      way `extractMockAnalysisFindings` does from `context.workItemDescription` (or a fixed
      template-driven fallback if no marker-style hint is present in the description).
- [x] 2.4 `config/prompts/tasks.md`: extend the instructions with the marker + schema requirement,
      mirroring `config/prompts/analyze.md`'s exact instruction shape.

## 3. Domain layer — persistence & materialization

- [x] 3.1 `src/domain/pipeline/commands.ts`: extend `completeStageDraft`'s existing TASKS-stage
      default branch (the `requiresApproval` fallthrough, not the `clarifyQuestions`/
      `analysisFindings` branches) to, when `result.taskDrafts` is present, delete any prior
      `TaskDraft` rows for the stage and create the new ones — same replace-not-accumulate
      discipline as `AnalysisFinding`.
- [x] 3.2 Create `src/domain/task-decomposition/commands.ts`: `materializeTaskDrafts(ctx, stageId,
      taskDraftIds)` — loads the stage + its pipeline + WorkItem + project, requires
      `requireClientRole(ctx, clientId, WRITE_ROLES)`, refuses unless `stage.type === "TASKS" &&
      stage.status === "DONE"`, refuses any requested id already materialized, then for each
      remaining id calls `createWorkItem` (`type: "TASK"`, `parentId` = pipeline's WorkItem id,
      title/description from the draft) and sets `TaskDraft.materializedWorkItemId`, recording one
      audit event summarizing the batch.
- [x] 3.3 Create `src/domain/task-decomposition/queries.ts`: `listTaskDraftsForStage` (read-access
      gated the same `ALL_ROLES` way `getRepositoryDetail` is).
- [x] 3.4 Unit tests: structured drafts persisted on a successful TASKS draft and replaced on
      redraft; materializing selected drafts from a `DONE` TASKS stage creates the expected child
      WorkItems and marks them materialized; materializing from a non-`DONE` stage is refused;
      re-materializing an already-materialized draft is refused; a read-only user is refused. 7
      tests, all passing.

## 4. API routes

- [x] 4.1 `GET /api/stages/[id]/task-drafts` (list) — `src/app/api/stages/[id]/task-drafts/route.ts`.
- [x] 4.2 `POST /api/stages/[id]/task-drafts/materialize` (materialize selected ids) —
      `src/app/api/stages/[id]/task-drafts/materialize/route.ts`.
- [x] 4.3 Both follow the existing error-handling pattern (domain errors → their HTTP status, Zod
      validation errors → 400), matching `src/app/api/requirements/route.ts` as the most recent
      precedent.

## 5. UI

- [x] 5.1 `src/components/TaskDraftsPanel.tsx` ("use client"), mirroring
      `AnalyzeFindingsPanel.tsx`'s presentation conventions: lists task drafts with a checkbox per
      un-materialized draft and a "Materialize Selected" button; an already-materialized draft
      renders a link to its created WorkItem instead of a checkbox.
- [x] 5.2 Wire it into `src/app/pipelines/[id]/page.tsx`, rendered when `stageConfig.type ===
      "TASKS" && stage.status === "DONE"`, mirroring the existing `AnalyzeFindingsPanel`
      conditional exactly; visible to any reader, the materialize action itself gated by
      `canManage` (already computed on that page).
- [x] 5.3 Empty state ("No task drafts for this run") when a `DONE` TASKS stage has none (e.g. an
      older pre-this-slice pipeline).

## 6. Tests

- [x] 6.1 Unit tests for `commands.ts`/`queries.ts` (covered by Task 3.4 above — listed as its own
      group for tracking, per this project's convention of a dedicated Tests group).
- [x] 6.2 E2E: drive a WorkItem's pipeline through to an approved TASKS stage, verify task drafts
      render, materialize a subset, confirm the resulting child WorkItems appear on the parent's
      360° Record / hierarchy — `e2e/task-decomposition.spec.ts`. Passing.

## 7. Documentation & verification

- [x] 7.1 Update `docs/ROADMAP.md`'s Slice 18 entry: mark status, summarize what was built (mirror
      the Slice 14/15 status-block format), and note the deferred non-goals explicitly.
- [x] 7.2 Run build, lint, typecheck, unit tests, and this change's E2E spec; confirm the full
      existing suite has no new failures beyond the already-known pre-existing
      `slice5-engineering-evidence.spec.ts` and `slice6-configuration-center.spec.ts` failures
      (verify via the same temporary-checkout method used for Slice 15, if any new failure
      appears). Build/lint/typecheck clean. Unit tests: 353/353 passing (7 new). Full E2E: 19/22
      passing, including this slice's new spec. Two additional failures appeared
      (`slice12-client-lifecycle.spec.ts`'s second test, `slice14-repository-discovery.spec.ts`),
      both an unrelated "Add project" Dashboard flow neither this slice nor Slice 15 touched;
      reproduced identically at the pre-Slice-18 commit (6cdd474) against the same accumulated
      local Postgres via a temporary checkout — confirmed environmental flakiness from repeated
      E2E runs building up Dashboard state in this session's shared DB, not a regression. Combined
      with the already-known `slice5`/`slice6` pre-existing failures, every failing spec in this
      run is accounted for as pre-existing/environmental, none caused by this change.
- [x] 7.3 Live verification: covered by `e2e/task-decomposition.spec.ts` (draft a TASKS stage in a
      real browser, approve it, materialize a subset of its drafts, confirm the created WorkItem
      appears on the parent's 360° Record) and `src/domain/task-decomposition/commands.test.ts`
      (non-`DONE`-stage refusal, already-materialized refusal, and a read-only/non-write-role user
      refused, all against a real Postgres instance).
