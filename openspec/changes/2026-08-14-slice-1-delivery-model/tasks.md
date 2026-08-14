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

## Task Group 2: Domain Layer — Work Item Commands (6 tasks)

**2.1** Implement `src/domain/work-item/commands.ts`: `createWorkItem`.
- Zod validation: projectId, type, title, description, ownerId, parentId (optional), dueDate (optional), risk (optional), priority (optional), executorType (optional), executorId (optional).
- Authorization: requireClientRole(clientId, ['Manager', 'ProjectManager']).
- Transaction: insert WorkItem with status='open', progress=0, sourceMode='manual'; record WORK_ITEM_CREATED audit event.
- Tests (Vitest): valid creation, missing required fields, authorization check, audit event recorded.

**2.2** Implement `src/domain/work-item/commands.ts`: `updateWorkItem`.
- Allow updates to: title, description, status, risk, priority, ownerId, executorType, executorId, dueDate, progress.
- Zod validation per field.
- Authorization: owner or Manager+.
- Transaction: update fields, record WORK_ITEM_UPDATED audit event.
- Tests: update with authorization, no permission to update, field validation.

**2.3** Implement `src/domain/work-item/commands.ts`: `updateWorkItemStatus`.
- Validate status transitions (state machine).
- Authorization: role-based (Manager+ can change status; Executor can advance in_progress→review).
- Side effect: if transitioning to 'blocked', verify a blocker exists; if transitioning from 'blocked', verify no active blockers remain.
- Transaction: update status, record WORK_ITEM_STATUS_CHANGED audit event.
- Tests: valid transitions, invalid transitions, authorization, side effects.

**2.4** Implement `src/domain/work-item/commands.ts`: `addParentWorkItem`.
- Validation: both work items exist, same project, no cycles.
- Authorization: Project Manager+.
- Transaction: update child parentId, record audit event.
- Tests: valid parent-child relationship, cycle detection, authorization.

**2.5** Implement `src/domain/work-item/queries.ts`: `getWorkItem`, `listWorkItems`, `getWorkItemsByStatus`, `getWorkItemHierarchy`.
- All queries respect tenant scoping and authorization.
- listWorkItems supports pagination and optional filters (type, status, owner, parentId).
- Tests: queries return correct data, pagination works, authorization enforced.

**2.6** Create API routes for work-item CRUD.
- `POST /api/work-items` → createWorkItem.
- `PATCH /api/work-items/[id]` → updateWorkItem.
- `PATCH /api/work-items/[id]/status` → updateWorkItemStatus.
- `PATCH /api/work-items/[id]/parent` → addParentWorkItem.
- Each route validates Zod input, calls domain command, returns JSON or error.
- Tests: Vitest for route handlers (mocked Prisma), authorization checks.
- Commit: "Implement work-item commands and API routes"

---

## Task Group 3: Domain Layer — Blocker Commands (4 tasks)

**3.1** Implement `src/domain/blocker/commands.ts`: `createBlocker`.
- Zod validation: blockingItemId, reason, requiredAction, ownerId, impact (optional).
- Authorization: Project Manager+ or item owner.
- Side effect: set work item status='blocked'.
- Transaction: insert Blocker, update status, record BLOCKER_CREATED audit event.
- Tests: valid creation, authorization, status side effect, audit event.

**3.2** Implement `src/domain/blocker/commands.ts`: `updateBlocker`.
- Allow updates to: reason, requiredAction, impact, ownerId.
- Authorization: blocker owner or Manager+.
- Transaction: update, record BLOCKER_UPDATED audit event.
- Tests: update with authorization, no permission.

**3.3** Implement `src/domain/blocker/commands.ts`: `resolveBlocker`.
- Validation: exists and resolvedAt=null.
- Authorization: blocker owner or Manager+.
- Side effect: set resolvedAt=now(); if no other active blockers, restore work item to 'open' or prior non-blocked status.
- Transaction: update, update work item status, record BLOCKER_RESOLVED audit event.
- Tests: resolution, status restoration, authorization.

**3.4** Implement queries: `getActiveBlockers`, `getAllActiveBlockers`, `getBlocker`.
- Respect tenant scoping and authorization.
- Tests: query correctness, authorization.
- Create API routes (`POST /api/blockers`, `PATCH /api/blockers/[id]`, `POST /api/blockers/[id]/resolve`).
- Commit: "Implement blocker commands and API routes"

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
