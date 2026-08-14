## Roadmap Source

This change implements **Slice 1** from `docs/ROADMAP.md` (row 1, "The delivery model and the Attention Center"), sourced from `docs/roadmap-sources/2026-08-14-gap-analysis-full.md` §5 "Slice 1":

> - Extend `WorkItem` to the master prompt's §4 shape: `type` (project/task/bug/change), `parentId`, `status` (the 9-state `WorkStatus`), `risk`, `priority`, `ownerId`, `executorType`/`executorId`, `dueDate`, `progress`, `sourceMode`, `aiCost`.
> - **`Dependency`** as a first-class entity between work items, with a stated reason. Cycle detection required.
> - **`Blocker`** as a first-class entity: reason, blockingItemId, ownerId, requiredAction, blockedSince, impact, resolvedAt.
> - **`Decision`** as a first-class entity: question, reason, impact, aiRecommendation, aiConfidence, deadline, approverId, status. Existing `Approval` records become the decision *outcome* on stage gates — reuse, don't duplicate.
> - **Attention Center** (`/attention`): every item needing a human, grouped — Decisions, Blockers, Risks, Deadlines, Clarifications, Approval Gates, Sync Problems. **Every row states why it is there.** Never render "Blocked" without the reason, the owner, and the required action.
> - **Dashboard** becomes a command center with clickable attention cards, not a project list.
> - **Quick View**: a side drawer on any work item — blocker panel or decision panel first, everything else after.
> - **360° Delivery Record** with tabs; in this slice implement Overview, Dependencies, and Timeline (per-item, from the existing `AuditEvent` data). Stub the rest with honest empty states, not fake data.
> - **Dependency Map** and a status board. Selecting a node highlights upstream, downstream, and the blocker chain, and dims the rest. The graph must be explanatory, not decorative — a user must be able to read *why* B depends on A.
> - Fix the audit trail: filters (project, actor, date, action) and pagination. The 200-row silent truncation is a defect in the product's core transparency promise.

**Open gaps to resolve in the implementation plan** (from `docs/ROADMAP.md`):

- The source defines `type` as (project/task/bug/change) and 3 of `WorkStatus`'s 9 states (`decision_required`, `blocked`, `review`), but does not give the remaining 6 `WorkStatus` values, a risk scale, a priority scale, `executorType`'s value set, or `sourceMode`'s value set.
- An implementation plan must either (a) get these from the still-missing 70-section Master Prompt document, or (b) propose concrete values as explicit, clearly-labeled assumptions for approval before any migration is written.

## Why

Slice 0 (Tenancy, identity, authorization) fixed the platform foundation. Slice 1 delivers the core product promise: a control plane that always answers **"what is happening, why, does anyone need to act, what happens next"** across the delivery path.

Today:
- Work items are flat, undifferentiated, with only a never-rendered `status` string.
- There is no model for dependencies, blockers, or decisions — only hard-coded status strings.
- The dashboard is a project list. The user must hunt for problems needing action. There is no Attention Center.
- The 360° record is almost entirely missing — only one tab (SDD pipeline), no dependencies, timeline, or evidence.
- The audit trail has no filters or pagination, silently truncates at 200 rows, and is a defect in the product's core transparency promise.

This slice extends the work-item model to the full shape (type, risk, priority, owner, executor, due date, progress, dependencies), adds Blocker, Decision, and Dependency as first-class entities (so the system can actually *explain* why something is blocked), and builds the delivery control plane around them: the Attention Center (every item needing action, grouped by type, with the reason stated), the Dashboard (command center with attention cards), Quick View (inline detail), 360° Record (multi-tab, with Dependencies and Timeline tabs implemented in this slice), and a fixed audit trail with pagination and filters.

## What Changes

### Domain Model Extensions

- **`WorkItem` extended**: new fields `type` (enum: project, task, bug, change), `parentId` (FK to parent WorkItem, nullable), `status` (9-state enum: `draft`, `open`, `in_progress`, `decision_required`, `blocked`, `review`, `approved`, `completed`, `closed`), `risk` (enum or scalar), `priority` (enum or scalar), `ownerId` (FK to User), `executorType` (enum), `executorId` (FK to User, nullable), `dueDate`, `progress` (0–100 or similar), `sourceMode`, `aiCost`.
- **`Dependency`** (new entity): `id`, `workItemId` (from), `dependsOnWorkItemId` (to), `reason`, `createdAt`, `createdBy`. Unique constraint: `(workItemId, dependsOnWorkItemId)`. With cycle-detection query helper.
- **`Blocker`** (new entity): `id`, `blockingItemId` (FK to WorkItem), `ownerId` (FK to User), `reason`, `requiredAction`, `blockedSince`, `impact`, `resolvedAt`, `createdAt`.
- **`Decision`** (new entity): `id`, `workItemId` (FK), `question`, `reason`, `impact`, `aiRecommendation`, `aiConfidence`, `deadline`, `approverId` (FK to User, nullable), `status` (enum: open, approved, rejected), `createdAt`, `resolvedAt`. Note: existing `Approval` records on stage gates become decision *outcomes* — keep them, link them.

### UI & Routes

- **`GET /attention`** — Attention Center. Grouped view (Decisions, Blockers, Risks, Deadlines, etc.) of every work item needing human action. Each row states *why* it appears, links to the work item, and offers inline actions (e.g. "resolve blocker", "approve decision").
- **`GET /`** — Dashboard (Home) becomes a command center: attention card summary (N decisions, M blockers, K risks, etc.), project quick-access, and recent activity. Not a project list.
- **Side drawer on any work item detail** — Quick View: shows blocker or decision first (if present), then full work-item detail, dependencies, and timeline.
- **`GET /work-items/[id]/360`** — 360° Delivery Record with tabs:
  - **Overview**: work item title, type, status, owner, executor, due date, progress, risk, decision/blocker status.
  - **Dependencies**: dependency graph + list; cycle detection.
  - **Timeline**: per-item audit trail from existing `AuditEvent` data; can group by actor or action type.
  - **Stubs (honest empty states)**: Code, Tests, Evidence, Configuration.
- **Dependency Map & Status Board**: visualization of work items and their dependency relationships. Selecting a node highlights upstream, downstream, blocker chain, and dims the rest. The graph must be explanatory — labels and reasons visible.
- **`GET /audit`** — Fixed audit trail with filters (by project, actor, date, action) and pagination. Remove the 200-row silent truncation.

### Authorization & Testing

- `WorkItem` create/read/update respects project membership and role-based permissions (inherited from Slice 0).
- New domain commands for Blocker, Decision, Dependency CRUD with authorization checks.
- End-to-end scenario must work: create client → create project → create work items → add dependency → create blocker → appears in Attention Center → Quick View → resolve blocker → timeline and audit reflect it. Tested.

## Capabilities

### New Capabilities

- `work-item-model`: Extended `WorkItem` shape (type, status, risk, priority, owner, executor, dueDate, progress, sourceMode, aiCost) with proper enums defined.
- `blocker`: First-class `Blocker` entity with reason, owner, and impact. Render never without context.
- `decision`: First-class `Decision` entity. Link to existing `Approval` as decision outcome.
- `dependency`: First-class `Dependency` entity with cycle detection.
- `attention-center`: `/attention` route grouping all items needing action, with reasons.
- `dashboard-command-center`: Home page as a command center with attention summary and recent activity.
- `quick-view`: Side drawer for work-item detail with blocker/decision priority.
- `delivery-record-360`: Multi-tab view (Overview, Dependencies, Timeline implemented; Code, Tests, Evidence, Configuration stubbed).
- `dependency-visualization`: Graph visualization of work-item dependencies and blocker chains.
- `audit-trail-fixed`: Audit trail with filters and pagination.

### Modified Capabilities

- `work-item-sync`: `WorkItem.status` now rendered everywhere (was stored but never displayed).

## Impact

Affected:
- `prisma/schema.prisma` (new models: `Dependency`, `Blocker`, `Decision`; extended `WorkItem`; new migrations).
- `src/domain/work-item/` (new commands and queries for extended model).
- `src/domain/blocker/`, `src/domain/decision/`, `src/domain/dependency/` (new domain modules).
- `src/app/` (new routes `/attention`, updated `/` dashboard, new `/work-items/[id]/360`; updated `/audit`).
- UI components for Attention Center, Quick View, 360° Record, dependency graph.
- Tests: Vitest unit tests for domain commands; Playwright e2e for Attention Center flow (create work item → add dependency → add blocker → verify Attention Center display → resolve blocker → verify timeline).

No changes to `AgentExecutor`, `IntegrationAdapter`, config mechanism, or authentication (leveraged from Slice 0).
