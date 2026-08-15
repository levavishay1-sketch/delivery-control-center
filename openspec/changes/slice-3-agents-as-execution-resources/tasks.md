# Tasks: Slice 3 — Agents as Real Execution Resources

## Overview

Makes AI execution a first-class, inspectable, boundable resource:
per-stage-type agent routing (config-driven, snapshotted per pipeline like
Slice 2's `stageSequence`), an `AgentRun` record per drafting attempt-cycle
(replacing ad-hoc cost columns as the source of truth), cost rollups, and
budget enforcement with an explicit, audited override. Tasks are grouped
into logical units, each testable and committable independently, per this
project's change-sizing convention (see Slice 2's tasks.md for the
established pattern).

## Task Group 1: Data Model & Migrations (6 tasks)

- [x] 1.1 Add `Agent` model: `id`, `name` (unique), `provider` (String — e.g. `"claude"`, `"mock"`), `model` (String, e.g. `"claude-sonnet-5"`), `isDefault` (Boolean, exactly one row `true` at a time — enforce in the domain command, not a DB constraint), `createdAt`/`updatedAt`.
- [x] 1.2 Add `AgentRun` model: `id`, `agentId` (FK to `Agent`), `jobId` (nullable FK to `Job` — the attempt-cycle this run tracks), `status` (new `AgentRunStatus` enum: `RUNNING`/`SUCCEEDED`/`FAILED`), `promptTokens`/`completionTokens`/`costUsd`, `retryCount` (Int, default 0), `lastError` (String?, nullable), `toolCalls` (Json?, nullable — unpopulated in this slice per design.md's Non-Goals, present for forward compatibility), `startedAt`, `completedAt` (nullable), `createdAt`.
- [x] 1.3 Add `BudgetOverride` model: `id`, `clientId` (nullable FK), `projectId` (nullable FK — exactly one of `clientId`/`projectId` set, enforced in the domain command), `approvedByUserId` (FK to User), `approvedAt`, `consumed` (Boolean, default false), `consumedAt` (nullable), `consumedByRunId` (nullable FK to `AgentRun`).
- [x] 1.4 Extend existing models: `Stage`, `Constitution`, `StageVersion` gain nullable `agentRunId` (FK to `AgentRun`). `Pipeline` gains `agentRouting` (Json, nullable — `{ [stageType]: agentId }`, resolved and snapshotted at `startPipeline` alongside `stageSequence`). `Client` and `Project` each gain `aiBudgetUsd` (Decimal, nullable — unset means no budget).
- [x] 1.5 Additive migration for everything above (`agentRunId` nullable, `agentRouting` nullable — no backfill required for these, unlike Slice 2's `stageSequence` which had to become `NOT NULL`; these stay nullable, "no run yet" / "no routing configured" are valid permanent states, not just a migration transient).
- [x] 1.6 Backfill migration (separate, per Slice 2's own precedent of not combining schema + data migrations): for every `Stage`/`Constitution` row where `aiModel IS NOT NULL`, create an `Agent` row (by `(provider, model)`, upserted so multiple stages sharing a model share one `Agent` row) if none exists yet, then create an `AgentRun` (`status: SUCCEEDED`, `retryCount: 0`, token/cost copied from the source row, `startedAt`/`completedAt` from the source row's own timestamps) and set the source row's `agentRunId`. Run against real local Postgres; verify existing seeded stage/constitution data gets a linked `AgentRun` and no `aiModel IS NOT NULL` row is left with `agentRunId IS NULL`.

## Task Group 2: Agent Registry & Routing (4 tasks)

- [x] 2.1 `src/domain/agent/queries.ts`: `getDefaultAgent()`, `getAgentById(id)`, `listAgents()`.
- [x] 2.2 `config/agents.yaml` (new file, same loading pattern as `config/workflow.yaml`) or an `agents:` top-level key added to `config/workflow.yaml` (pick one — prefer reusing `workflow.yaml` per design.md Decision 3's "no new config file" framing unless it makes the file unwieldy): each entry seeds/matches an `Agent` row by name; exactly one marked default. `src/lib/config.ts` gains `loadAgents()` and validates exactly one default at load time (mirroring the `approverRoles`-non-empty validation Slice 2 added).
- [x] 2.3 Extend `WorkflowStageConfig` with an optional `agent?: string` (registry entry name). `startPipeline` (`src/domain/pipeline/commands.ts`) resolves each configured stage's agent (falling back to the default) into `Pipeline.agentRouting` in the same transaction that snapshots `stageSequence`.
- [x] 2.4 Tests: `loadAgents()` rejects a config with zero or multiple defaults; `startPipeline` snapshots the correct `agentRouting` map; editing `config/workflow.yaml`'s agent routing after a pipeline starts doesn't change that pipeline's `agentRouting` (same pattern as the existing `stageSequence`-immutability test). Commit: "Add the Agent registry and per-stage-type routing, snapshotted per pipeline"

## Task Group 3: AgentRun Recording (5 tasks)

- [x] 3.1 `src/domain/agent/commands.ts`: `startAgentRun(agentId, jobId)` — creates an `AgentRun` row with `status: RUNNING`, `startedAt: now()`. `completeAgentRun(runId, { promptTokens, completionTokens, costUsd })` — sets `SUCCEEDED`, `completedAt`. `failAgentRun(runId, { retryCount, error })` — updates `retryCount`/`lastError` on retry (job not yet exhausted, `AgentRun` stays `RUNNING`); on final exhaustion, sets `FAILED`, `completedAt`.
- [x] 3.2 `worker.ts`'s `handleDraftStageJob`/`handleDraftConstitutionJob`: resolve the stage's/constitution's routed agent (`pipeline.agentRouting[stage.type]` or the project's default for Constitution), call `startAgentRun` before invoking the executor, `completeAgentRun`/`failAgentRun` after — wired into the same transaction boundaries `completeStageDraft`/`completeConstitutionDraft`/`revertStageDraftFailure`/`revertConstitutionDraftFailure` already use.
- [x] 3.3 `completeStageDraft`/`completeConstitutionDraft`: set the drafted row's `agentRunId` to the just-completed run, alongside (not instead of — design.md Decision 2) writing `aiModel`/`promptTokens`/`completionTokens`/`costUsd` as before, now sourced from the `AgentRun`. `StageVersion` rows also gain `agentRunId`.
- [x] 3.4 On job retry (`failJob`'s reschedule path, not final exhaustion): call `failAgentRun`'s retry-increment branch so `AgentRun.retryCount` stays in sync with `Job.attempts` without creating a new run row (design.md Decision 1).
- [x] 3.5 Tests: a successful draft creates exactly one `SUCCEEDED` `AgentRun` linked from the `Stage`; a redraft creates a second `AgentRun`, the first unchanged; a retried-then-succeeded job's single `AgentRun` shows the correct `retryCount`; an exhausted job's `AgentRun` is `FAILED` with `lastError` set and the stage still reaches `REJECTED` exactly as it did pre-Slice-3. Commit: "Record every drafting attempt as an AgentRun"

## Task Group 4: Cost Rollups (3 tasks)

- [x] 4.1 `src/domain/agent/queries.ts`: `getWorkItemAiCost(workItemId)`, `getProjectAiCost(projectId)`, `getClientAiCost(clientId)` — sum `AgentRun.costUsd` joined through `Stage`/`Constitution` up to the requested scope.
- [x] 4.2 API routes or extend existing detail-page loaders (360° Record, project view) to surface the rollup — read-only, `ALL_ROLES` access (cost summary is visible to read-only roles per design.md's permissioned-detail requirement; only raw run detail is write-gated).
- [x] 4.3 Tests: rollup sums match the sum of underlying `AgentRun.costUsd` across multiple stages/redrafts/constitution versions; a work item/project/client with no runs yet returns zero, not an error.

## Task Group 5: Budget Enforcement & Override (5 tasks)

- [x] 5.1 `src/domain/agent/commands.ts`: `checkBudget(clientId, projectId)` — resolves the effective budget (project's `aiBudgetUsd` if set, else the client's, else unbounded per design.md Decision 4's client-vs-project precedence), compares against `getClientAiCost`/`getProjectAiCost`, and atomically consumes an unconsumed `BudgetOverride` for that scope if the budget is exceeded and one exists (`UPDATE ... WHERE consumed = false RETURNING`, same claim pattern as `Job.claimJobs`). Returns whether drafting may proceed.
- [x] 5.2 `draftStage`/`draftConstitution` (`src/domain/pipeline/commands.ts`, `src/domain/constitution/commands.ts`): call `checkBudget` before enqueueing; refuse with `ConflictError` naming the exceeded budget if it returns false. No `Job` row is created on refusal.
- [x] 5.3 `approveBudgetOverride(ctx, { clientId? , projectId? })` — `WRITE_ROLES`-gated, creates an unconsumed `BudgetOverride`, records an audit event naming who approved it and for which scope.
- [x] 5.4 API routes: `POST /api/clients/[id]/ai-budget` / `POST /api/projects/[id]/ai-budget` (set threshold, `WRITE_ROLES`), `POST /api/clients/[id]/budget-override` / `POST /api/projects/[id]/budget-override` (approve past budget).
- [x] 5.5 Tests: drafting is refused once a scope's accrued cost meets/exceeds its budget, and no `Job` is created; an unbudgeted scope is never refused; an approved override allows exactly one subsequent draft to proceed and is then consumed (a second draft past budget after that needs its own new override); a project-level budget overrides its client's; concurrent requests against a single override never both consume it (claim-race test mirroring `Job.claimJobs`'s existing concurrency test). Commit: "Enforce AI cost budgets with an explicit, audited override"

## Task Group 6: Permissioned Run Detail Visibility (2 tasks)

- [x] 6.1 `src/domain/agent/queries.ts`: `getAgentRunDetail(ctx, runId)` — `WRITE_ROLES`-gated (full detail including `lastError`/`toolCalls`); a separate `getAgentRunSummary(ctx, runId)` — `ALL_ROLES`-gated (status/cost only, no error/tool detail), used wherever a read-only role needs to see "did this succeed and what did it cost" without the raw failure detail.
- [x] 6.2 Tests: a read-only role calling `getAgentRunDetail` is refused (`ForbiddenError`); the same role's `getAgentRunSummary` call succeeds and omits `lastError`/`toolCalls`; a write-capable role's `getAgentRunDetail` call returns full detail.

## Task Group 7: UI (4 tasks)

- [ ] 7.1 Pipeline detail page: per-stage run summary (agent/model, cost, status) always visible; a "View run detail" expand showing structured error/retry count, rendered only when the viewer's role passes `getAgentRunDetail`'s check (page-level `ctx` role check, same pattern Slice 2 used for role-based gate messaging).
- [ ] 7.2 Project/client view: AI cost rollup display (total, this-month if cheap to compute, else all-time only — avoid inventing a time-bucketing feature not asked for).
- [ ] 7.3 Budget configuration UI: set/clear a client's or project's `aiBudgetUsd` (`WRITE_ROLES`).
- [ ] 7.4 Budget-exceeded UX: `DraftButton`/`ConstitutionDraftButton` surface the `ConflictError`'s budget message; an "Approve to continue" action (visible only to `WRITE_ROLES`) calls `approveBudgetOverride` and retries the draft.

## Task Group 8: End-to-End Test Scenario (1 task)

- [ ] 8.1 Playwright E2E: configure a low budget on a test project → draft stages until the budget is exceeded → verify drafting is refused with the budget error shown in the UI → approve an override → verify the next draft proceeds → verify the override is consumed (a further draft past budget is refused again) → view a stage's run detail as a write-capable role (sees full detail) and as a read-only role (sees summary only, no raw error) → verify the project's cost rollup reflects every run. No console errors.

## Task Group 9: Unit Tests for Domain Logic (2 tasks)

- [ ] 9.1 Vitest integration tests (real local Postgres) for every new domain module not already covered inline above: `agent` (registry, run recording, rollups, budget check, override claim) — cross-cutting `pipeline`/`constitution` changes (agent routing snapshot, budget-gated drafting) not already exercised by Task Groups 2/3/5's own test tasks.
- [ ] 9.2 Confirm no regression in the existing Slice 0/1/2 domain test suite (`npm test`) — `completeStageDraft`/`completeConstitutionDraft`'s signature/behavior changes (now also linking `agentRunId`) touch existing tests in `pipeline/commands.test.ts` and `constitution/commands.test.ts`; update those call sites/assertions, don't leave them silently broken. Commit: "Add comprehensive unit tests for Slice 3 domain logic"

## Task Group 10: Documentation & Verification (1 task)

- [ ] 10.1 Update `docs/PRODUCT_SPEC.md` to reflect Slice 3 (Agent registry, AgentRun tracking, cost rollups, budget enforcement, permissioned run visibility). Update `docs/ROADMAP.md`'s gap register (items #27, #28, #31 — and re-confirm #29/#32's Slice-2-partial annotations still read correctly now that retry/backoff and structured errors are further built out) and move Slice 3's row to Done, linked to the archived change. Verify no dead code/unused imports (`npm run lint`, `npx tsc --noEmit`). Full verification: `npm run build`, `npm run lint`, `npm test`, `npx playwright test`, `openspec validate --specs`. Archive this OpenSpec change per `docs/ROADMAP.md`'s own stated process, syncing its delta specs into `openspec/specs/`.

---

## Verification Checklist (End-to-End)

Before marking Slice 3 complete:

- [ ] All migrations run without errors; no data loss; every existing drafted `Stage`/`Constitution` row has a linked `AgentRun` after the backfill.
- [ ] Editing `config/workflow.yaml`'s agent routing after a pipeline starts never changes that pipeline's behavior.
- [ ] A budget genuinely blocks drafting; clearing it requires a real, audited override — not a silent bypass or a permanent limit increase.
- [ ] An override is consumed by exactly one draft, never shared across concurrent requests.
- [ ] Raw run detail (structured error, tool calls) is invisible to read-only roles; cost/status summary is not.
- [ ] Redrafting preserves every prior `AgentRun`, never overwriting one.
- [ ] All Slice 0/1/2 functionality continues to work — full existing test suite passes.
- [ ] Build succeeds; lint passes; `tsc --noEmit` clean.
- [ ] E2E scenario passes against the real dev server, real Postgres, and the worker process actually running.
- [ ] `PRODUCT_SPEC.md` and `docs/ROADMAP.md` updated; change archived; specs synced.
