## 1. Domain layer — cost/time estimation

- [x] 1.1 `estimateExecutorCost(workItemType, risk, priority)` in `src/domain/agent/queries.ts`:
      averages `costUsd` and duration (`completedAt - startedAt`) over completed `AgentRun`s
      joined through `stageVersions → stage → pipeline → workItem` matching type/risk/priority;
      falls back to type-only, then a global average across every completed run (design.md
      decision 1 said "org-wide" — implemented as global since the function takes no
      client/org-scoping parameter; there's no tenant context to scope by at this signature),
      when there isn't enough matching history; returns `null` when there's no history at all
      (design.md decision 4).
- [x] 1.2 Unit tests: an exact type/risk/priority match is used, weighted correctly against any
      pre-existing history (tested via before/after delta since this runs against a shared,
      accumulating test database — same pattern `getClientAiCost`'s own test already uses);
      falls back to a type-only average when no exact match exists; falls back to a global
      average for a WorkItem type/risk/priority combination expected to have no history. The
      true always-`null`-with-zero-history case isn't asserted directly against the shared
      database (no reliable way to guarantee true global emptiness across accumulated test runs)
      — the third test tolerates either a global-fallback result or `null`, whichever the
      database's actual state produces.

## 2. Domain layer — recommendation

- [x] 2.1 `recommendExecutor(ctx, workItemId)` in a new `src/domain/recommendation/queries.ts`:
      reads the WorkItem's `risk`/`priority`/`type`, calls `estimateExecutorCost`, applies the
      threshold heuristic (design.md decision 2) to produce `{ recommended: "AI_AGENT" | "HUMAN",
      why, assumptions, aiEstimate: { costUsd, durationMinutes } | null }`. Read-access-gated
      (`requireClientRole(ctx, project.clientId, ALL_ROLES)`) — a recommendation is informational,
      no write.
- [x] 2.2 Unit tests: LOW/MEDIUM risk with a cheap AI estimate recommends AI; HIGH/CRITICAL risk
      recommends a developer regardless of estimate; an expensive AI estimate at LOW/MEDIUM risk
      recommends a developer; the "no data" case recommends a developer with an explicit
      no-history "why" (asserted conditionally — same shared-database caveat as task 1.2); a
      read-only user can still get a recommendation; a user without project access is refused;
      a nonexistent work item throws `NotFoundError`. 7 tests, all passing.

## 3. UI — AiRecommendationCard

- [x] 3.1 `src/components/AiRecommendationCard.tsx`: shared card shape (What/Why/Assumptions/
      Estimated time/Estimated cost/What happens under each alternative), two override buttons
      ("Assign to AI" / "Assign to a developer"), neither visually pre-selected/default-styled
      (design.md decision 6 / project's established no-default-pre-selected pattern from Slice
      19).
- [x] 3.2 "Assign to AI" calls the existing `PATCH /api/work-items/[id]` (`executorType:
      "AI_AGENT"`) directly. "Assign to a developer" opens the existing executor-picker flow
      (reuses `EditWorkItemForm`'s HUMAN-executor picker, design.md decision 6) rather than
      duplicating a user-select control inside the card.
- [x] 3.3 Wire into `src/components/OverviewTab.tsx`: renders the card only when
      `workItem.executorType === "UNASSIGNED"`, adjacent to the existing executor field, calling a
      new API route that wraps `recommendExecutor`. Gated by `canManage` — the card's override
      actions are writes, same access rule as the tab's other action buttons.
- [x] 3.4 New `GET /api/work-items/[id]/recommendation` route wrapping `recommendExecutor`.

## 4. Tests

- [ ] 4.1 E2E: create a WorkItem with no executor, verify the recommendation card renders with a
      What/Why/Assumptions/estimate shown, click "Assign to AI", verify the WorkItem's executor
      becomes `AI_AGENT` and the card no longer renders (executor no longer unassigned) —
      `e2e/ai-recommendation-card.spec.ts`.

## 5. Documentation & verification

- [ ] 5.1 Update `docs/ROADMAP.md`'s Slice 17 entry: mark status, summarize what was built (mirror
      the Slice 16/18/19 status-block format), and note the deferred non-goals explicitly (Blocker
      criticality, Execution Readiness, model selection, developer time/cost estimation, migrating
      other AI-facing surfaces onto the shared card).
- [ ] 5.2 Run build, lint, typecheck, unit tests, and this change's E2E spec; confirm the full
      existing suite has no new failures beyond the already-known pre-existing baseline (verify
      via the temporary-checkout method used for prior slices if any new failure appears).
- [ ] 5.3 Live verification: open a WorkItem with no executor in the browser, confirm the
      recommendation card renders with a real (not fabricated) estimate for a project with AI
      drafting history, confirm both override buttons work, confirm the card disappears once an
      executor is assigned.
