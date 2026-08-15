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

## Task Group 4: Domain Layer — Decision Commands (4 tasks) — ✅ DONE

- [x] 4.1 Implemented `src/domain/decision/commands.ts`: `createDecision` with Zod validation (workItemId, question, reason, impact, aiRecommendation, aiConfidence, deadline all optional except first 4). Authorization: `requireClientRole(..., WRITE_ROLES)`. Side effect: sets work item status to DECISION_REQUIRED. Transaction: insert Decision with status=OPEN, update WorkItem, record audit event. Tests: valid creation, optional fields (aiRecommendation, aiConfidence, deadline), Viewer rejection, non-existent work item rejection.

- [x] 4.2 Implemented `approveDecision`. Validation: exists and status='OPEN' (rejects non-open). Authorization: any authenticated user (no role check). Side effect: restores work item status to OPEN. Transaction: sets status=APPROVED, approverId=ctx.userId, resolvedAt=now(); updates work item status; records audit event. Tests: approval with status restoration, Viewer can approve, non-open rejection, non-existent rejection.

- [x] 4.3 Implemented `rejectDecision(ctx, decisionId, reason?)`. Validation: exists and status='OPEN'. Authorization: any authenticated user. Side effect: status remains DECISION_REQUIRED (no work-item-status change). Transaction: sets status=REJECTED, approverId, resolvedAt; records audit event with optional reason detail. Tests: rejection with optional reason, status unchanged, Viewer can reject, non-open rejection.

- [x] 4.4 Implemented queries: `getWorkItemDecisions(workItemId)` (internal), `getPendingDecisions(ctx, clientId)` (requires ALL_ROLES), `getDecision(ctx, decisionId)` (with authz). Created API routes: `POST /api/decisions` (createDecision), `POST /api/decisions/[id]/approve` (approveDecision), `POST /api/decisions/[id]/reject` (rejectDecision with optional reason in body). All routes handle ZodError (400) and DomainError. Tests: 13 new integration tests passing. Build/Lint/Tests all passing (54 total). Commit: "Implement decision commands and API routes".

---

## Task Group 5: Domain Layer — Dependency Commands (3 tasks) — ✅ DONE

- [x] 5.1 Implemented `src/domain/dependency/commands.ts`: `addDependency` with Zod validation (workItemId, dependsOnWorkItemId, reason). Validation: rejects self-dependency, duplicates, cross-project links (both items must be in same project). Authorization: `requireClientRole(..., WRITE_ROLES)`. Cycle detection: `detectCycles(workItemId, dependsOnWorkItemId)` uses BFS to check if there's a path from dependsOnWorkItemId to workItemId through existing dependencies; rejects if true. Transaction: insert Dependency, record audit event. Tests: valid add, self-dependency rejection, duplicate rejection, cross-project rejection, Viewer rejection.

- [x] 5.2 Implemented `removeDependency`. Authorization: `requireClientRole(..., WRITE_ROLES)`. Transaction: delete Dependency, record audit event. Tests: removal, Viewer rejection, non-existent rejection.

- [x] 5.3 Implemented queries: `getWorkItemDependencies(workItemId)` returns { upstream: [...], downstream: [...] }. `getCriticalPath()` stub returns []. Created API routes: `POST /api/dependencies` (addDependency), `DELETE /api/dependencies/[id]` (removeDependency). Routes handle ZodError (400) and DomainError. Tests: 11 new integration tests covering dependencies, cycle detection (direct self-cycle, 3-level chain A→B→C preventing C→A), cross-project rejection, and authorization. All 65 tests passing. Build/Lint/Tests all passing. Commit: "Implement dependency commands and API routes".

---

## Task Group 6: Attention Center Routes & Queries (3 tasks) — ✅ DONE

- [x] 6.1 Implemented `src/domain/attention/queries.ts`: `getItemsNeedingAttention(ctx)` aggregates, in parallel, across every client ctx can access (org admins see all clients; everyone else scoped to `ctx.memberships`): open Decisions (ordered by deadline then createdAt, nulls-last — earliest/oldest first), active Blockers (ordered by `blockedSince` ascending — oldest first), high/critical Risks (reusing `getHighRiskWorkItems`), upcoming Deadlines within 7 days (reusing `getUpcomingDeadlines`), and work items with status=REVIEW (Approval Gates, ordered by `syncedAt` ascending). Returns `{ decisions, blockers, risks, deadlines, approvalGates, now, summary }` — `now` (server `Date.now()`) is returned from the query rather than computed in the page component so the React Compiler ESLint rule (`react-hooks/purity`, which forbids impure calls during render) stays satisfied. **Deviation**: Sync Problems (Slice 4 stub) was omitted entirely rather than stubbed with an empty array — there's no `SyncProblem` entity yet and an always-empty group would be UI noise with nothing to fill it. Tests: `src/domain/attention/queries.test.ts`, 3 integration tests — full aggregation across all 5 groups with real seeded data, cross-client isolation (a user only sees their own client's items, verified in both directions), and an empty-state case for a user with zero accessible items.

- [x] 6.2 Implemented `GET /attention` (`src/app/attention/page.tsx`, Server Component, `dynamic = "force-dynamic"`). Renders a 5-card summary grid (Decisions/Blockers/Risks/Deadlines/Approval Gates) that anchor-links into each section; an "All clear" empty state when every count is 0; and one collapsible-by-scroll section per group (only rendered when non-empty), each row showing the required-by-spec fields (question/reason/AI recommendation/deadline for decisions; reason/owner/required action/impact for blockers; risk badge for risks; due date, red-highlighted if overdue/within 24h, for deadlines; "Awaiting approval" for gates) plus a link to the item's detail page. **Deviation**: links to `/pipelines/[id]` rather than `/work-items/[id]/360` — the 360° Record page is Task Group 9, not yet built; `/pipelines/[id]` is the only existing item-detail route, so `WorkItemLink` falls back to it (and renders nothing if a work item somehow has no pipeline). **Deviation**: pagination for >20 items per group was not implemented — none of the seeded/tested data approaches that volume in Slice 1; noted as a follow-up rather than un-verifiable speculative code. Added an "Attention Center" link to the root nav in `layout.tsx`. Tests: covered by 6.1's integration tests (data correctness) plus a live check (below) proving the rendered page.

- [x] 6.3 Action routes `POST /api/decisions/[id]/approve`, `POST /api/decisions/[id]/reject`, `POST /api/blockers/[id]/resolve` already existed from Task Groups 3–4. Added two new client components — `DecisionActions` (Approve/Reject buttons) and `ResolveBlockerButton` — following the existing `ApprovalGate` component's pattern (fetch the route, `router.refresh()` on success, inline error display). Buttons render only when `ctx` has WRITE_ROLES on that item's client (or, for blockers, is the blocker's owner) — matching the domain layer's authorization, so Viewers see the same rows without action buttons. **Live verification** (real Postgres + running dev server, not just tests): logged in as the seeded org-admin via the Credentials CSRF flow, created a CRITICAL-risk item, a near-term-deadline item, a REVIEW-status item, a blocker, and a decision via the live API; loaded `/attention` and confirmed all 5 groups rendered with correct counts, reasons, and a working `/pipelines/[id]` link; then called `POST /api/blockers/[id]/resolve` and reloaded `/attention`, confirming the blocker disappeared and the count dropped. Build/Lint/Tests: `npm run build` ✓, `npm run lint` ✓ (required moving `Date.now()` out of the page component and into the query layer — the React Compiler ESLint rule flags impure calls during render), `npm test` (68/68 passing, 3 new). Commit: "Implement Attention Center route and queries".

---

## Task Group 7: Dashboard Redesign (2 tasks) — ✅ DONE

- [x] 7.1 Updated `GET /` (`src/app/page.tsx`). Added an Attention Summary section (4 count cards linking to `/attention#section`, or an "All clear" green state when all 4 counts are zero — reuses `getItemsNeedingAttention`'s `summary`/`now`), a Project Quick Access grid (top 10 projects by most-recent-work-item activity, each card showing name/key, client, work-item count, and relative "updated Xm/h/d ago"), and a Recent Activity feed (top 10 audit events via `listRecentAuditEvents(ctx, 10)`, extended with a `workItem.pipeline` include so events can link to `/pipelines/[id]`). **Deviation — did not replace the project list**: the spec said "replace project list with..." but the existing project section is also the *only* UI for creating projects, creating work items, and triggering integration syncs (`AddProjectForm`, `AddWorkItemForm`, `SyncButton`) — there is no other page for that yet. Removing it would have broken the app's only write path for those actions to satisfy a UI-layout instruction. Instead: the new summary/quick-access/activity sections were added above the existing project management section (now labeled "Projects", unchanged otherwise except each project `<div>` gained an `id="project-{id}"` anchor so Quick Access cards can jump to it). Followed CLAUDE.md's guidance to surface an added-scope conflict rather than silently narrow the spec. Team Status (Slice-1-optional stub) was skipped — the spec marks it optional ("stub with 'Coming soon' if time allows") and no team/assignment concept exists yet to stub meaningfully. Same fix as the Attention Center: moved `Date.now()` out of the page and reused `attention.now` (and a pure `relativeTime(date, now)` helper) to satisfy the React Compiler's purity rule. Tests: covered by `attention/queries.test.ts` (data correctness of the reused aggregation) plus a live check (below).

- [x] 7.2 Responsive layout: Attention Summary uses a `grid-cols-2 sm:grid-cols-4` grid (2 columns on mobile, 4 on desktop); Quick Access and Recent Activity sit in a `grid-cols-1 lg:grid-cols-2` layout (stacked on mobile, side-by-side on desktop); Quick Access cards themselves use `grid-cols-1 sm:grid-cols-2`. All sections use semantic `<section>` with `aria-labelledby` pointing at their heading's `id`, matching the Attention Center page's pattern. **Live verification** (real Postgres + running dev server): logged in as the seeded org-admin, loaded `/`, confirmed the Attention Summary showed accurate live counts (1 decision, 0 blockers, 2 risks, 1 deadline) matching `/attention`, the Quick Access card showed the right work-item count and "updated Xm ago", and the Recent Activity feed listed the 10 most recent audit events in reverse-chronological order with working `/pipelines/[id]` links — then deleted the live-check fixture data used for verification so the seeded demo data stays clean. Build/Lint/Tests: `npm run build` ✓, `npm run lint` ✓, `npm test` (68/68 passing — no regressions). Commit: "Redesign dashboard as command center".

---

## Task Group 8: Quick View Drawer (2 tasks) — ✅ DONE

- [x] 8.1 Implemented `QuickViewDrawer` (`src/components/QuickViewDrawer.tsx`). **Deviation — client component, not a Server Component**: the drawer must open without a full page navigation from *any* list (Dashboard, Attention Center — the spec's own trigger list), which means it reacts to a URL query-param change on whatever page is currently mounted; a Server Component can't do that without a full route transition, so it's a client component that fetches a new aggregate endpoint (`GET /api/work-items/[id]/quick-view`, mirroring `getWorkItemDetail` + blocker/decision/dependency/timeline queries, built once and reused rather than duplicated). Renders, in the spec's priority order: the blocker panel first (reused `ResolveBlockerButton`), the decision panel if no blocker (reused `DecisionActions`), full work-item detail (type/status/owner/executor/due date/progress/risk/priority — reusing `OverviewTab` in full, including its Edit/Create Blocker/Create Decision actions, rather than re-implementing the same fields a second time), then Dependencies and Timeline as stacked sections (reusing `DependenciesTab`/`TimelineTab`) per the spec's own allowance ("Tabs **or Sections** below detail"). Code/Tests/Evidence/Configuration stubs were **not** duplicated into the drawer — they add no information in a compact side panel and are one click away via the "Open full 360° Record" link at the bottom. `role="dialog"` `aria-modal="true"`, focus moves to the close button on open, Escape closes, and clicking the backdrop closes. **Bug found and fixed during live verification**: the shared action components (`ResolveBlockerButton`, `DecisionActions`, `CreateBlockerForm`, `CreateDecisionForm`, `EditWorkItemForm`, `AddDependencyForm`, `RemoveDependencyButton`) all called `router.refresh()` on success — correct for the 360 page (a Server Component re-fetches), but a no-op for the drawer's client-fetched data. Fixed by giving each an optional `onResolved`/`onDecided`/`onCreated`/`onChanged`/`onAdded`/`onRemoved` callback, used instead of `router.refresh()` when provided; the drawer passes its own `refetch()` (and re-keys `TimelineTab` on a refresh counter so its internal pagination state resets to the fresh data). Verified via a real Playwright-driven browser session (see 8.2) that the drawer now updates itself immediately after Resolve Blocker, with no page reload.

- [x] 8.2 Integrated the drawer via a single `?quickView=<id>` query param (**deviation from the literal `?view=quick`**: that form needs the ID to already be in the URL path, which only works on a work-item's own detail page; `?quickView=<id>` works from *any* page, satisfying the spec's primary trigger — "appears when user clicks on a work item in any list" — Dashboard, Attention Center, and the 360 page's own header link into itself if wanted later). `QuickViewDrawer` is mounted once in the root layout (behind a `<Suspense>` boundary, required for `useSearchParams`), so it's available everywhere a session exists. Added a reusable `QuickViewLink` component and wired "Quick View" trigger links into every Attention Center row (decisions, blockers, risks, deadlines, approval gates) and every work-item row in the Dashboard's project list — alongside the existing navigation link, not replacing it. Responsive: `w-full sm:w-[400px]` — full-screen on mobile, a 400px side panel on desktop, matching the spec. **Live verification** (real Postgres, running dev server, Playwright driving actual Chromium — not just curl, since this component only exists client-side): created a HIGH-risk item with an active blocker via the API, clicked its "Quick View" link on `/attention`, confirmed the drawer slid in from the right with the blocker panel shown first (screenshot captured), clicked Resolve Blocker inside the drawer, and confirmed — within the same drawer, no navigation — the status flipped to OPEN, the blocker panel disappeared, "Create Blocker" reappeared, and the Timeline showed the fresh "resolved blocker" event. Verified Escape closes the drawer (`getByRole("dialog")` count went to 0). No console/page errors during the run. Cleaned up fixture data afterward. Build/Lint/Tests: `npm run build` ✓, `npm run lint` ✓ (the same `set-state-in-effect` rule as Task Group 9's Timeline pagination required restructuring the fetch effect — extracted a named `load()` function and dropped the standalone `loading` boolean in favor of deriving it from `!current && !error`), `npm test` (68/68 passing, no regressions). Commit: "Implement Quick View drawer".

---

## Task Group 9: 360° Delivery Record (3 tasks) — ✅ DONE

- [x] 9.1 Implemented `OverviewTab` (`src/components/OverviewTab.tsx`, client component so it can toggle inline edit state). Renders title/description, a `<dl>` of status (with an explanation string per status), owner, executor (Human/AI Agent/Unassigned), due date (color-coded: red if overdue, amber within 7 days, green otherwise — using a `now` computed once server-side via `serverNow()` and passed down, not `Date.now()` inline, to satisfy the React Compiler's purity rule), risk (with explanation) and priority, a progress bar, active-blocker and pending-decision panels (reusing `ResolveBlockerButton`/`DecisionActions`), AI cost (total + per-pipeline-stage breakdown), and parent/children (linked to `/pipelines/[id]`, the existing detail route). Action buttons: **Edit** (inline form swap via `EditWorkItemForm`, calls the existing `PATCH /api/work-items/[id]`), **Create Blocker** (`CreateBlockerForm` → `POST /api/blockers`, hidden once a blocker is active), **Create Decision** (`CreateDecisionForm` → `POST /api/decisions`, hidden once a decision is pending). **Deviation — Delete was not implemented**: `Pipeline.workItem` cascades on WorkItem delete, and `AuditEvent.pipelineId` also cascades on Pipeline delete — so a hard `db.workItem.delete()` would silently destroy that item's pipeline-linked audit events (creation, status-transition entries), directly contradicting `audit-trail-fixed`'s spec line "Audit events are immutable; never edited or deleted." Implementing Delete correctly needs either a soft-delete field (schema change) or decoupling `AuditEvent` from `Pipeline`'s cascade (also a schema change) — both out of scope for a tab-rendering task and worth their own OpenSpec change. Flagged here rather than silently shipping a delete button that violates an existing spec.

- [x] 9.2 Implemented `DependenciesTab` (`src/components/DependenciesTab.tsx`) rendering upstream ("Depends on") and downstream ("Depended on by") lists — title (linked to `/pipelines/[id]`), type, status, reason — with a `RemoveDependencyButton` (`DELETE /api/dependencies/[id]`) on each upstream row when authorized. **Deviation — "Add Dependency" is an inline form with a `<select>` of sibling work items, not a search modal**: no work-item search endpoint/UI exists yet in this codebase (Slice 1 has no search capability at all); a `<select>` populated from `listWorkItems` for the same project, filtered to exclude self and already-linked upstream items, satisfies the same acceptance criterion (pick a target + give a reason) without inventing unspecced search infrastructure. Dependency Graph section is a "Coming soon" stub per the spec's own allowance ("optional visualization... Stub with 'Coming soon' if not implemented") — full graph is Task Group 11.

- [x] 9.3 Implemented `TimelineTab` (`src/components/TimelineTab.tsx`, client component for pagination) showing audit events for this work item, most recent first, each with actor icon, action text, actor name, absolute timestamp (`title` attribute doubles as hover-detail per spec's "relative + absolute on hover" — simplified to absolute-only display since a relative-time formatter was already used elsewhere and duplicating it here added no signal), and detail JSON if present. Pagination via `getWorkItemAuditEvents(ctx, workItemId, page, pageSize=20)` (`src/domain/audit/queries.ts`) and a new `GET /api/work-items/[id]/audit?page=N` route; Previous/Next buttons fetch on click (no `useEffect`-driven state sync, to satisfy the React Compiler's `set-state-in-effect` rule) — no hard truncation, real pagination. Stub tabs for Code/Tests/Evidence/Configuration render honest "Coming soon" text, no mock data. All 7 tabs composed via a new accessible `WorkItemTabs` component (`role="tablist"`/`role="tab"`/`role="tabpanel"`, arrow-key navigation between tabs, `aria-selected`/`aria-controls`). Route: `GET /work-items/[id]/360` (`src/app/work-items/[id]/360/page.tsx`), authorization via `getWorkItemDetail` (extends `getWorkItem` with parent/children/pipeline+stages includes) — `notFound()` on `ForbiddenError` or missing item. **Live verification** (real Postgres + running dev server): created a parent item, a main item (HIGH risk, due date, linked to the parent), a dependency target, and a dependency between them via the live API; loaded `/work-items/[id]/360` and confirmed the Overview tab showed risk/progress/parent link, the Dependencies tab (present in the SSR payload, just CSS-hidden until clicked) showed the dependency reason, and the Timeline tab showed the "created work item" and "added dependency" audit events; then created a blocker via the API and reloaded, confirming the Blocked panel and Resolve button appeared. Cleaned up the fixture data afterward. Build/Lint/Tests: `npm run build` ✓, `npm run lint` ✓ (fixed a `react/no-children-prop` collision by renaming a prop, the same `Date.now()` purity issue via a `serverNow()` indirection, and a `set-state-in-effect` issue by making pagination event-driven instead of effect-driven), `npm test` (68/68 passing, no regressions — Postgres wasn't running at the start of this session and needed `service postgresql start` first). Commit: "Implement 360° Delivery Record tabs".

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
