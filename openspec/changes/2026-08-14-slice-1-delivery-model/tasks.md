# Tasks: Slice 1 — Delivery Model and Attention Center

## Overview

Slice 1 extends the work-item model, adds Blocker, Decision, and Dependency entities, and builds the delivery control plane UI around them. Tasks are grouped into logical units, each testable and committable independently.

## Task Group 1: Data Model & Migrations (5 tasks) — ✅ DONE

- [x] 1.1 Create Prisma migration: add fields to `WorkItem` (type, parentId, status, risk, priority, ownerId, executorType, executorId, dueDate, progress, aiCost). Enums: `WorkItemType`, `WorkStatus` (9 values), `RiskLevel`, `PriorityLevel`, `ExecutorType`. **Deviation from the original task wording**: no separate `sourceMode` field was added — `WorkItem.source: IntegrationType` already serves that role (see design.md's "Enums & Value Sets" note); adding a second field would have duplicated it. Defaults for existing rows: type=TASK, status=OPEN, risk=MEDIUM, priority=MEDIUM, progress=0. Migration: `20260814191505_slice1_delivery_model`.
- [x] 1.2 Create Prisma migration: add `Dependency` model (workItemId, dependsOnWorkItemId, reason; unique on the pair; FKs cascade). Included in the same migration as 1.1 (Prisma generates one migration per `prisma migrate dev` run against the current schema diff).
- [x] 1.3 Create Prisma migration: add `Blocker` model (blockingItemId, ownerId, reason, requiredAction, blockedSince, impact, resolvedAt). Included in the same migration.
- [x] 1.4 Create Prisma migration: add `Decision` model (workItemId, question, reason, impact, aiRecommendation, aiConfidence, deadline, approverId, status, resolvedAt). Included in the same migration. Also added `AuditEvent.workItemId` (nullable FK) — not in the original task list, but required so Blocker/Decision/Dependency audit events (which have no `pipelineId`) can trace back to a work item, and so the Timeline tab (Task Group 9) can query per-item history. `recordAuditEvent()` remains the single write path; extended, not replaced.
- [x] 1.5 Ran the migration against a real local Postgres (no `DATABASE_URL` was configured in this environment; started the pre-installed `postgresql@16` service and pointed `.env`, gitignored, at it). Verified: `npx prisma generate`, `npx tsc --noEmit` (clean besides pre-existing Next.js 16 generated-type errors that only appear via bare `tsc`, not `next build`), `npm run build` (clean), `npm run lint` (clean), `npm run db:seed` (clean — fixed a `status: "open"` string literal in `prisma/seed.ts` left over from the old free-string status field), and a live `psql` inspection of `WorkItem`'s new columns and the seeded row. Commit: "Add Slice 1 data models: WorkItem extension, Dependency, Blocker, Decision".

---

## Task Group 2: Domain Layer — Work Item Commands (6 tasks) — ✅ DONE

- [x] 2.1 `createWorkItem` now Zod-validates its input (`createWorkItemSchema`) and records its own `WORK_ITEM_CREATED`-equivalent audit event with a `workItemId`. **Deviation**: authorization uses `requireClientRole(ctx, clientId, WRITE_ROLES)` (every role except VIEWER), matching every other command in the codebase — the "Manager, ProjectManager" pairing in the original task wording doesn't correspond to an actual role hierarchy; `authz.ts` only distinguishes write-capable roles from VIEWER (per-stage-type role policy is explicitly deferred to Slice 2 in `docs/ROADMAP.md`'s resolved-conflicts list).
- [x] 2.2 `updateWorkItem` (title, description, risk, priority, ownerId, executorType, executorId, dueDate, progress). Zod-validated (`updateWorkItemSchema`, e.g. `progress` clamped 0–100). Status is deliberately excluded — that's `updateWorkItemStatus`'s job (see 2.3) so the state machine has one entry point.
- [x] 2.3 `updateWorkItemStatus` validates transitions via `src/domain/work-item/status.ts`'s `assertValidTransition`. **Deviation from the original wording**: BLOCKED and DECISION_REQUIRED are unreachable from this command in *either* direction, not conditionally gated — entering them is a side effect of `createBlocker`/`createDecision` (Groups 3–4, not yet built), and leaving them is a side effect of `resolveBlocker`/`approveDecision`/`rejectDecision`. This is simpler than a runtime "check no active blocker exists" gate and makes the one legitimate way to reach/leave those states impossible to bypass accidentally.
- [x] 2.4 `addParentWorkItem` — same-project check, self-parent rejection, and a full ancestor-chain walk to reject cycles (tested with a 3-level A→B→C chain).
- [x] 2.5 `src/domain/work-item/queries.ts`: `getWorkItem`, `getWorkItemById` (unchecked, internal use), `listWorkItems` (paginated, filtered), `getWorkItemsByStatus`, `getWorkItemHierarchy`, plus `getHighRiskWorkItems` and `getUpcomingDeadlines` — added ahead of schedule because Task Group 6 (Attention Center) needs them and they belong with the rest of the WorkItem query surface.
- [x] 2.6 API routes: `GET`/`PATCH /api/work-items/[id]`, `PATCH /api/work-items/[id]/status`, `PATCH /api/work-items/[id]/parent`. Existing `POST /api/work-items` updated to pass the body straight to `createWorkItem` (now that Zod validates it) and to return 400 on `ZodError`.
- [x] Tests: `src/domain/work-item/commands.test.ts`, 16 integration tests against a **real local Postgres** (not mocked — see the file's top comment for why), covering valid creation, defaults, explicit fields, Viewer rejection, Zod rejection (empty title, out-of-range progress, cross-project parent), valid/invalid/terminal status transitions, audit event content, and parent/cycle handling. Full suite: `npm run build`, `npm run lint`, `npx tsc --noEmit` (clean besides the pre-existing bare-`tsc` `RouteContext` gap), `npm test` (28/28 passing across all 4 suites). Commit: "Slice 1 Task Group 2: WorkItem update/status/parent commands, queries, API routes".

---

## Task Group 3: Domain Layer — Blocker Commands (4 tasks) — ✅ DONE

- [x] 3.1 Implemented `src/domain/blocker/commands.ts`: `createBlocker` with Zod validation (blockingItemId, reason, requiredAction, ownerId, impact). Authorization: `requireClientRole(..., WRITE_ROLES)`. Side effect: sets work item status to BLOCKED. Transaction: insert Blocker, update WorkItem status, record audit event with blockingItem title and reason. Tests: valid creation with defaults, optional impact field, Viewer rejection, non-existent work item/owner rejection.

- [x] 3.2 Implemented `updateBlocker` (reason, requiredAction, impact, ownerId). Authorization: blocker owner (checked via ownerId) OR WRITE_ROLES. Transaction: update, record audit event with changes. Tests: field updates, owner-only update, non-existent blocker rejection.

- [x] 3.3 Implemented `resolveBlocker`. Validation: exists and resolvedAt=null (rejects if already resolved). Authorization: blocker owner OR WRITE_ROLES. Side effect: sets resolvedAt=now(); queries active blocker count for workItemId; if count=0 after this blocker's resolution, restores workItem status to OPEN. Transaction: update blocker and work item, record audit event. Tests: resolution and status restoration, multiple blockers (status remains BLOCKED until all resolved), already-resolved rejection, owner-only resolution, Viewer rejection.

- [x] 3.4 Implemented queries: `getActiveBlockers(workItemId)` (internal, no authz), `getAllActiveBlockers(ctx, clientId)` (requires ALL_ROLES), `getBlocker(ctx, blockerId)` (requires ALL_ROLES). Created API routes: `POST /api/blockers` (createBlocker), `PATCH /api/blockers/[id]` (updateBlocker), `POST /api/blockers/[id]/resolve` (resolveBlocker). All routes handle ZodError (400) and DomainError (per error.status). Tests: 16 integration tests against real Postgres, all passing (28/28 suite total). Commit: "Implement blocker commands and API routes".

---

## Task Group 4: Domain Layer — Decision Commands (4 tasks)

**4.1** Implement `src/domain/decision/commands.ts`: `createDecision`.
- Zod validation: workItemId, question, reason, impact, aiRecommendation (optional), aiConfidence (optional), deadline (optional).
- Authorization: Project Manager+ or work item owner.
- Side effect: set work item status='decision_required'.
- Transaction: insert Decision, update status, record DECISION_CREATED audit event.
- Tests: valid creation, authorization, status side effect.

**4.2** Implement `src/domain/decision/commands.ts`: `approveDecision`.
- Validation: exists and status='open'.
- Authorization: any authenticated user (approval is recorded).
- Side effect: restore work item to 'open' or 'in_progress'.
- Transaction: set status='approved', approverId, resolvedAt=now(), update work item, record DECISION_APPROVED audit event.
- Tests: approval, status restoration, authorization.

**4.3** Implement `src/domain/decision/commands.ts`: `rejectDecision`.
- Validation: exists and status='open'.
- Authorization: any authenticated user.
- Side effect: keep status='decision_required'.
- Transaction: set status='rejected', approverId, resolvedAt=now(), record DECISION_REJECTED audit event with reason.
- Tests: rejection, status unchanged, audit event.

**4.4** Implement queries: `getPendingDecisions`, `getWorkItemDecision`, `getDecision`.
- Create API routes (`POST /api/decisions`, `POST /api/decisions/[id]/approve`, `POST /api/decisions/[id]/reject`).
- Commit: "Implement decision commands and API routes"

---

## Task Group 5: Domain Layer — Dependency Commands (3 tasks)

**5.1** Implement `src/domain/dependency/commands.ts`: `addDependency`.
- Zod validation: workItemId, dependsOnWorkItemId, reason.
- Validation: both items exist, same project, no cycles (call `detectCycles`).
- Authorization: Project Manager+ or dependent work item owner.
- Transaction: insert Dependency, record DEPENDENCY_ADDED audit event.
- Tests: valid add, duplicate detection, cycle detection, authorization.

**5.2** Implement `src/domain/dependency/commands.ts`: `removeDependency`.
- Authorization: Project Manager+ or dependent work item owner.
- Transaction: delete, record DEPENDENCY_REMOVED audit event.
- Tests: removal, authorization.

**5.3** Implement queries: `getWorkItemDependencies`, `detectCycles`, `getCriticalPath` (stub for Slice 2).
- `getWorkItemDependencies` returns upstream and downstream with reasons.
- `detectCycles(workItemId, candidateTargetId)` returns boolean.
- Create API routes (`POST /api/dependencies`, `DELETE /api/dependencies/[id]`).
- Commit: "Implement dependency commands and API routes"

---

## Task Group 6: Attention Center Routes & Queries (3 tasks)

**6.1** Implement `src/domain/attention/queries.ts`: `getItemsNeedingAttention`.
- Aggregate and group all items:
  - **Decisions**: all pending (open) decisions.
  - **Blockers**: all active blockers.
  - **Risks**: all work items with risk >= 'High'.
  - **Deadlines**: all work items with dueDate within 7 days.
  - **Approval Gates**: all work items with status='review'.
  - (Stub for Sync Problems, Slice 4.)
- Each group sorted by urgency (overdue first).
- Respect tenant scoping and user authorization (only items in user's projects).
- Tests: aggregation correctness, sorting, authorization.

**6.2** Implement `GET /attention` Server Component.
- Call `getItemsNeedingAttention()`.
- Render each group (Decisions, Blockers, Risks, Deadlines, Approval Gates) with items and actions.
- Summary card at top (N decisions, M blockers, K risks, X deadlines).
- Pagination if any group has > 20 items (20 per page).
- Tests: component renders, data is correct, pagination works.

**6.3** Implement action routes: `POST /api/decisions/[id]/approve`, `POST /api/decisions/[id]/reject`, `POST /api/blockers/[id]/resolve`.
- These already exist from Task Groups 4 and 3.
- Verify Attention Center refreshes after action.
- Commit: "Implement Attention Center route and queries"

---

## Task Group 7: Dashboard Redesign (2 tasks)

**7.1** Update `GET /` (Home) Server Component.
- Replace project list with:
  - Attention summary card (4 counts with links to `/attention#section`).
  - Project quick-access grid/list (top 5–10 projects).
  - Recent activity feed (top 10 audit events).
- Respect authorization (Viewer can see summaries but not approve).
- Tests: component renders, counts are accurate, authorization enforced.

**7.2** Design and implement responsive layout.
- Desktop: attention card top, projects grid middle, activity feed below.
- Mobile: stack vertically.
- Accessible: semantic HTML, ARIA labels.
- Tests: responsive breakpoints, keyboard navigation.
- Commit: "Redesign dashboard as command center"

---

## Task Group 8: Quick View Drawer (2 tasks)

**8.1** Create a QuickView component (Server Component) that renders:
- Blocker panel (if exists) — reason, owner, required action, resolve button.
- Decision panel (if exists, no blocker) — question, reason, AI recommendation, approve/reject buttons.
- Work-item detail — type, status, owner, executor, due date, progress, risk, priority.
- Dependency tabs (upstream, downstream).
- Timeline tab (audit events).
- Placeholder/stub tabs (Code, Tests, Evidence, Configuration).
- Tests: component renders, data is populated, actions work.

**8.2** Integrate QuickView into work-item detail pages.
- Option 1: append `?view=quick` to trigger side drawer.
- Option 2: add a side drawer button on the main detail page.
- Ensure responsive behavior (side drawer on desktop, full-screen modal on mobile).
- Tests: drawer appears/closes, responsive behavior.
- Commit: "Implement Quick View drawer"

---

## Task Group 9: 360° Delivery Record (3 tasks)

**9.1** Create Overview tab component.
- Render: title, type, status (with explanation), owner, executor, due date, progress bar, risk, priority, blocker status, decision status, AI cost (if applicable), parent/children.
- Action buttons (if authorized): Edit, Delete, Add Dependency, Create Blocker, Create Decision.
- Tests: component renders, authorization checks, links work.

**9.2** Create Dependencies tab component.
- Upstream dependencies list (title, type, status, owner, reason, remove button).
- Downstream dependents list (same structure).
- "Add Dependency" button opens a modal to search and add.
- Tests: data rendered, add/remove work, authorization.

**9.3** Create Timeline tab component.
- Audit events for this work item (most recent first).
- Each event: timestamp (relative + absolute on hover), actor, action, object, changed fields (if applicable).
- Pagination (20 events per page).
- Stub tabs for Code, Tests, Evidence, Configuration (honest "Coming soon" empty states).
- Tests: events rendered, pagination works, no hard truncation.
- Create route `GET /work-items/[id]/360` with all tabs.
- Commit: "Implement 360° Delivery Record tabs"

---

## Task Group 10: Fixed Audit Trail (2 tasks)

**10.1** Update `GET /audit` Server Component with filters and pagination.
- Filter inputs: project, actor, action, date range.
- Pagination: 20/50/100 rows per page (user-selectable).
- Remove hard 200-row truncation.
- Each row: timestamp, actor, action, object, link.
- Tests: filters work, pagination works, authorization enforced.

**10.2** Responsive design for audit trail.
- Desktop: table layout.
- Mobile: card layout.
- Accessible: ARIA labels, keyboard navigation.
- Commit: "Fix audit trail with filters and pagination"

---

## Task Group 11: Dependency Graph Visualization (2 tasks)

**11.1** Implement dependency graph visualization component.
- Directed graph: nodes are work items, edges are dependencies.
- Selecting a node highlights it (green), upstream (blue), downstream (purple), and dims unrelated.
- Edge labels show dependency reason (on hover or always visible).
- Uses a graph library (e.g., Cytoscape.js, D3.js, or Recharts + custom logic). **To be decided in implementation plan.**
- Tests: node selection, highlighting, edge labels.

**11.2** Integrate graph into Dependency tab or a separate view.
- Ensure responsive behavior (zoomable, pannable, touch-friendly on mobile).
- Tests: responsive, interactive.
- Commit: "Implement dependency graph visualization"

---

## Task Group 12: End-to-End Test Scenario (1 task)

**12.1** Implement Playwright E2E test: create client → create project → create work items → add dependency → create blocker → appears in Attention Center → open Quick View → resolve blocker → verify timeline and audit trail reflect the change.
- Steps:
  1. Log in as authenticated user.
  2. Create a new client (inherited from Slice 0).
  3. Create a new project in that client.
  4. Create two work items (e.g., "Backend API" and "Database Schema").
  5. Add a dependency: Backend API depends on Database Schema.
  6. Create a blocker on Backend API: "Waiting for DBA review".
  7. Navigate to Attention Center, verify blocker is shown with reason.
  8. Click on the work item to open Quick View, verify blocker panel is displayed.
  9. Resolve the blocker via Quick View.
  10. Verify timeline shows the blocker resolution event.
  11. Verify audit trail shows the blocker creation and resolution events.
- Tests: all steps execute, data is persistent, no console errors.
- Commit: "Add E2E test for Slice 1 end-to-end scenario"

---

## Task Group 13: Unit Tests for Domain Logic (2 tasks)

**13.1** Write Vitest unit tests for all domain commands and queries.
- **WorkItem**: createWorkItem, updateWorkItem, updateWorkItemStatus, addParentWorkItem, hierarchy cycle detection.
- **Blocker**: createBlocker, updateBlocker, resolveBlocker, status side effects.
- **Decision**: createDecision, approveDecision, rejectDecision, status restoration.
- **Dependency**: addDependency, removeDependency, cycle detection.
- Tests should cover: valid inputs, invalid inputs, authorization checks, side effects, audit events.
- Tests: all pass.

**13.2** Write tests for aggregation queries (Attention Center, Dashboard).
- `getItemsNeedingAttention`: verify grouping, sorting, authorization.
- Dashboard queries: verify counts are accurate, authorization enforced.
- Tests: all pass.
- Commit: "Add comprehensive unit tests for Slice 1 domain logic"

---

## Task Group 14: Documentation & Cleanup (1 task)

**14.1** Update PRODUCT_SPEC.md to reflect Slice 1 changes.
- Describe the extended WorkItem model.
- Document Blocker, Decision, Dependency entities and their use cases.
- Update the gap register (docs/ROADMAP.md) to mark relevant items as done/extended.
- Verify no dead code or unused imports are left.
- Commit: "Update PRODUCT_SPEC.md for Slice 1; verify specs match implementation"

---

## Verification Checklist (End-to-End)

Before marking Slice 1 complete:

- ✅ All migrations run without errors; no data loss.
- ✅ All domain commands respect authorization and record audit events.
- ✅ Attention Center displays decisions, blockers, risks, deadlines, approval gates.
- ✅ Quick View renders work-item detail, blocker/decision panels, dependencies, timeline.
- ✅ 360° Record tabs (Overview, Dependencies, Timeline) are populated and functional.
- ✅ Dashboard shows attention summary, projects, recent activity.
- ✅ Audit trail has filters and pagination; no silent truncation.
- ✅ Dependency graph visualizes dependencies explanatorily.
- ✅ E2E scenario (create → add dependency → blocker → Attention Center → resolve) works end-to-end against real DB.
- ✅ Unit tests pass (domain logic).
- ✅ Build succeeds (npm run build).
- ✅ Lint passes (npm run lint).
- ✅ All routes render without permission or database errors (for authorized users).
- ✅ Responsive design works on desktop, tablet, mobile.
- ✅ Keyboard navigation works on all interactive elements.
- ✅ WCAG 2.2 AA accessibility target met (headings, labels, contrast, focus indicators).
- ✅ No console errors in tests or E2E runs.
- ✅ PRODUCT_SPEC.md updated to reflect implementation.

---

## Notes

- **Enum value sets** (Risk, Priority, WorkStatus, ExecutorType, SourceMode) are defined in Task 1.1. If the 70-section Master Prompt document becomes available before implementation, update these as needed. Current assumptions are documented in `design.md`.
- **Graph library**: dependency visualization may require a new npm package. Review candidates and confirm choice in the implementation plan.
- **Task order**: tasks are structured for parallelization. Groups 2–5 (domain commands) can be worked in parallel after Group 1 (migrations) is complete.
- **Commits**: each task group has a recommended commit point. Verify tests pass and the change is cohesive before committing.
