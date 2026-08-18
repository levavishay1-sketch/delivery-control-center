## 1. Data model & migration

- [ ] 1.1 Add `ModelSnapshot` model to `prisma/schema.prisma` (`id`, `fetchedAt DateTime`, `status`
      enum `SUCCESS`/`FAILED`, `rawContent String`, `extractedModels Json`, `failureReason
      String?`), per design.md Decision 7.
- [ ] 1.2 Add `FETCH_MODEL_SNAPSHOT` to the `JobType` enum.
- [ ] 1.3 Run `npx prisma migrate dev --name ai_model_knowledge_snapshot`, regenerate the client,
      and regenerate route types (`rm -rf .next && npx next typegen`) per this project's Prisma 7 /
      Next.js 16 conventions.

## 2. Job runtime: self-requeuing weekly fetch

- [ ] 2.1 Add an optional `scheduledAt?: Date` parameter to `enqueueJob`
      (`src/domain/job/commands.ts`); when provided, set `Job.scheduledAt` to it instead of
      defaulting to `now()` (design.md Decision 1). Confirm every existing call site is unaffected
      (parameter is optional).
- [ ] 2.2 Add a `nextSunday07UTC(from: Date): Date` helper (or inline equivalent) computing the
      next Sunday 07:00 UTC strictly after `from`.
- [ ] 2.3 Add `ensureModelSnapshotJobScheduled()` to `src/domain/model-snapshot/commands.ts`: if no
      `FETCH_MODEL_SNAPSHOT` job is currently `QUEUED` or `RUNNING`, enqueue one for the next
      Sunday 07:00 with idempotency key `model-snapshot-<YYYY-MM-DD>` (design.md Decision 3).

## 3. Fetch + extraction

- [ ] 3.1 Add `src/lib/integrations/modelKnowledgeSource.ts` (or similar): `fetchModelSnapshotSource()`
      calls `fetch("https://platform.claude.com/docs/en/about-claude/models/overview")` and returns
      the raw response text; throws on a non-2xx response (eligible for the existing job-runtime
      retry/backoff, matching the GitHub adapter's error handling).
- [ ] 3.2 In the same module, add `extractModelFacts(rawHtml: string)`: strip HTML tags, scan for
      model-id-shaped substrings, dollar amounts near "per million/1M tokens" language, and
      context-window figures (design.md Decision 2); return an array of
      `{ modelId, pricingText?, contextWindowText?, capabilitiesText? }`, keeping only entries with
      a recognized name plus at least one recognized fact (Zod-validated).
- [ ] 3.3 Unit tests for `extractModelFacts` against a handful of representative fixture HTML
      snippets (a well-formed one, one with no recognizable pricing, one with no models at all) —
      confirms the "failed extraction never presents fabricated data" behavior at the parser level
      before it reaches the job handler.

## 4. Domain commands & queries

- [ ] 4.1 Add `recordModelSnapshotAttempt` (`src/domain/model-snapshot/commands.ts`): given
      extraction results (or a failure reason), creates a `ModelSnapshot` row with the appropriate
      `status`, `rawContent`, `extractedModels`, `failureReason`.
- [ ] 4.2 Add `getLatestSuccessfulModelSnapshot` (`src/domain/model-snapshot/queries.ts`): returns
      the most recent `ModelSnapshot` with `status: SUCCESS`, or `null` if none exists.
- [ ] 4.3 Add `recommendModel(ctx, workItemId)` (`src/domain/model-snapshot/queries.ts`): resolves
      the `Agent` that would execute the WorkItem via the existing `resolveDefaultAgentId`, looks
      up that `Agent.model` in the latest successful snapshot's `extractedModels`, and returns a
      recommendation confirming that model with the snapshot's facts and fetch date as the "why" —
      or a staleness caveat if the model isn't found in the snapshot (design.md Decision 5). Falls
      back to `claudeExecutor.ts`'s existing hardcoded model/cost constants when no successful
      snapshot exists yet. Reuses `estimateExecutorCost` (Slice 17, `src/domain/agent/queries.ts`)
      for the estimated-cost figure (design.md Decision 6) — gated `ALL_ROLES` like
      `recommendExecutor`, read-only/informational.

## 5. Job runtime wiring

- [ ] 5.1 Add `handleFetchModelSnapshotJob` to `worker.ts`: calls `fetchModelSnapshotSource` +
      `extractModelFacts`, records the attempt via `recordModelSnapshotAttempt`, then reschedules
      next Sunday's job via `enqueueJob(..., scheduledAt: nextSunday07UTC(...))` — on both the
      success and the recognized-empty-extraction paths.
- [ ] 5.2 Add `handleFetchModelSnapshotExhausted` to `worker.ts`: records a `FAILED`
      `ModelSnapshot` with the exhaustion error as `failureReason`, and — deliberately diverging
      from every other job type's `onExhausted` (design.md Decision 4) — also reschedules next
      Sunday's job, so a transient outage doesn't end the weekly cadence.
- [ ] 5.3 Register both handlers in `worker.ts`'s `handlers` map under `FETCH_MODEL_SNAPSHOT`.
- [ ] 5.4 Call `ensureModelSnapshotJobScheduled()` once at `worker.ts` startup, before `pollLoop()`
      begins (design.md Decision 3).

## 6. API route

- [ ] 6.1 Add `GET /api/work-items/[id]/recommendation/model` (or fold into the existing
      `GET /api/work-items/[id]/recommendation` route with a discriminated response — decide during
      implementation which reads more naturally given the existing route's shape) wrapping
      `recommendModel`, following the existing route's `DomainError` → status-code convention.

## 7. UI

- [ ] 7.1 Add a second `AiRecommendationCard` call site on the Overview tab
      (`src/components/OverviewTab.tsx`), rendered when `canManage && workItem.executorType ===
      "AI_AGENT"`, fetching from the new route — mirroring the existing `UNASSIGNED`-gated call
      site exactly (self-fetching client-island pattern), per the `ai-recommendation` spec's new
      "A WorkItem's AI model recommendation is shown when AI is the executor" requirement.
- [ ] 7.2 Render the snapshot's fetch date in the card as the freshness indicator, per the
      `ai-recommendation` spec's "shows how current that source is" scenario.

## 8. Tests

- [ ] 8.1 Unit tests for `ensureModelSnapshotJobScheduled` (schedules when none pending, no-op when
      one is already `QUEUED`/`RUNNING`) and the `enqueueJob` `scheduledAt` parameter
      (`src/domain/job/commands.test.ts`).
- [ ] 8.2 Unit tests for `recommendModel` (`src/domain/model-snapshot/queries.test.ts`): confirms
      the configured model when present in the snapshot, the staleness caveat when absent, the
      hardcoded-constant fallback when no successful snapshot exists, and access control.
- [ ] 8.3 Unit tests for `recordModelSnapshotAttempt` (success and failure paths).

## 9. E2E test scenario

- [ ] 9.1 Add `e2e/ai-model-knowledge-snapshot.spec.ts`: seeds a `ModelSnapshot` directly (a real
      weekly fetch against the live external page is not suitable for E2E), sets a WorkItem's
      executor to `AI_AGENT`, verifies the model-recommendation card renders on its Overview tab
      with the recommended model, why, assumptions, estimate, and the snapshot's fetch date visible.

## 10. Documentation & verification

- [ ] 10.1 Update `docs/ROADMAP.md`'s Slice 20 status block with the build summary, following the
      established pattern (what was built, deferred, and the full verification result).
- [ ] 10.2 Run build, lint, typecheck, the full unit test suite, and this change's E2E spec;
      confirm no regressions using the temporary-checkout diagnostic method against the pre-slice
      baseline commit if any new-looking E2E failure appears, per this session's established
      practice.
