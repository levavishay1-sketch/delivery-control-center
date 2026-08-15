# Design: Slice 1 — Delivery Model and Attention Center

## Architecture

### Data Layer

Three new domain models extend the work-item tracking system:

**`Dependency`** — models relationships between work items. A work item can have upstream dependencies (others it depends on) and downstream dependents (others that depend on it). Includes cycle-detection validation at creation.

**`Blocker`** — represents an impediment to progress: *why* a work item or stage is stalled. Contains the reason, the owner responsible for unblocking, and the required action. When a blocker is created, the dependent work item's status becomes `blocked`.

**`Decision`** — represents a question requiring human judgment, e.g., "Which execution model?" or "Proceed with the current risk assessment?" Links to an `aiRecommendation` and confidence. On stage gates, existing `Approval` records become decision *outcomes*.

**`WorkItem` extended** — adds fields for type (project/task/bug/change), risk/priority/executor/owner, due date, and progress tracking. The `status` field moves from a free string to a proper 9-state enum: `draft`, `open`, `in_progress`, `decision_required`, `blocked`, `review`, `approved`, `completed`, `closed`.

### Domain Layer

Each entity gets a domain module in `src/domain/<aggregate>/`:

- **`work-item/` commands**: `createWorkItem`, `updateWorkItem`, `updateWorkItemStatus`, `addParent`.
- **`blocker/` commands**: `createBlocker`, `resolveBlocker`, `updateBlocker`.
- **`decision/` commands**: `createDecision`, `approveDecision`, `rejectDecision`.
- **`dependency/` commands**: `addDependency`, `removeDependency` (checks cycles).

All commands follow the pattern: Zod validation → authorization check → transaction → audit event → typed result.

Query functions expose read-only data for the Attention Center:

- `getWorkItemsNeedingAttention()` → grouped by type (Decisions, Blockers, Risks, etc.).
- `getWorkItemDependencies(workItemId)` → upstream and downstream, with reasons.
- `getWorkItemTimeline(workItemId)` → filtered `AuditEvent`s for this work item.

### UI Layer

**Attention Center** (`/attention`)  
A command center showing every work item needing action:
- Decisions (pending approval)
- Blockers (active)
- Risks (score >= threshold)
- Deadlines (due within 7 days)
- Approval gates (awaiting approver)
- Sync problems (from integrations, Slice 4)

Each row shows:
- Item title, owner, work item type
- The *reason* (e.g., "Blocked by Bug #42", "Risk: complex scope")
- Quick actions (approve, resolve blocker, take executor role, etc.)

**Dashboard** (Home, `/`)  
Redesigned as a command center:
- Summary cards: N decisions pending, M blockers active, K risks, X deadlines
- Project quick-access buttons
- Recent activity feed (top 5 audit events)
- Link to Attention Center

**Quick View** (side drawer on work-item detail)  
Progressive disclosure:
1. If blocker exists: blocker panel (reason, owner, required action, "Resolve" button)
2. If decision exists: decision panel (question, AI recommendation, deadline, approve/reject buttons)
3. Below: full work-item detail (type, status, owner, executor, dueDate, progress, risk, priority)
4. Tabs to Dependencies, Timeline

**360° Delivery Record** (`/work-items/[id]/360`)  
Tabbed view:
- **Overview**: summary + status + owner/executor/due date + risk + decision/blocker status
- **Dependencies**: both directions (upstream "depends on", downstream "depended on by"), with reasons and links
- **Timeline**: filtered per-item audit trail with date filters and actor grouping
- **Code, Tests, Evidence, Configuration**: stubbed with "Coming soon" honest empty states (no placeholder data)

**Dependency Visualization**  
Directed graph showing work-item nodes and dependency edges:
- Selecting a node highlights it, upstream nodes, downstream nodes, and blocker relationships
- Dims unrelated nodes
- Edge labels show dependency reason
- Must be readable and explanatory, not decorative

**Fixed Audit Trail** (`/audit`)  
Existing `/audit` route, now with filters and pagination:
- Filter by project, actor, action type, date range
- Pagination (20 rows per page)
- Remove the 200-row silent truncation

## State Transitions

### WorkItem Status Lifecycle

```
draft → open → in_progress → (decision_required | blocked | review) → approved → completed
                                                                     ↘ closed (anytime)
```

- **`draft`**: initial state, not yet active
- **`open`**: ready to start
- **`in_progress`**: work has started
- **`decision_required`**: decision entity exists, awaiting approval
- **`blocked`**: blocker entity exists
- **`review`**: awaiting stage approval or manual review
- **`approved`**: approved by necessary party (stage gate or explicit approval)
- **`completed`**: finished successfully
- **`closed`**: canceled or not pursued further

Transitions are guarded by authorization and recorded as audit events.

### Blocker Lifecycle

- Created: work item status becomes `blocked`
- Updated: reason or owner can change
- Resolved: work item status returns to previous state (or `open` if unknown); `resolvedAt` recorded

### Decision Lifecycle

- Created: `status: open`
- Approved: `status: approved`, `approverId` and `resolvedAt` recorded
- Rejected: `status: rejected`, `resolvedAt` recorded

## Enums & Value Sets

**Open question** (see Roadmap Source): the source names `type` as (project/task/bug/change) and 3 of 9 `WorkStatus` states, but does not specify the remaining 6 values, a risk scale, a priority scale, `executorType` values, or `sourceMode` values.

**Assumption for this design** (to be approved before implementation):

- **`WorkStatus`** (9 states): `draft`, `open`, `in_progress`, `decision_required`, `blocked`, `review`, `approved`, `completed`, `closed`
- **`WorkItemType`**: `project`, `task`, `bug`, `change`
- **`Risk`**: categorical (Low, Medium, High, Critical) or numeric (1–5). Prioritize categorical for explainability.
- **`Priority`**: categorical (Low, Medium, High, Critical) or numeric (1–5). Recommend categorical.
- **`ExecutorType`**: `human`, `ai-agent`, `hybrid`, `unassigned`
- **`SourceMode`**: `jira`, `azure-devops`, `github`, `manual`

These are recommendations to keep the design simple and explainable; the implementation plan will confirm them.

## Testing Strategy

### Domain Unit Tests (Vitest)

- **Dependency creation**: add valid dependency, verify record exists; add cycle, expect error.
- **Blocker creation**: create blocker, verify work-item status becomes `blocked`; resolve, verify status reverts.
- **Decision creation & approval**: create, verify status is `open`; approve, verify status and dates; reject, verify status.
- **Authorization**: non-owner cannot create blocker on item; Viewer cannot approve decision.

### E2E Scenario (Playwright)

End-to-end test matching the required scenario:

1. Create client (inherited from Slice 0)
2. Create project in that client
3. Create two work items
4. Add dependency (A depends on B)
5. Create blocker on A
6. Verify Attention Center shows blocker with reason
7. Click into Quick View, see blocker panel
8. Resolve blocker
9. Verify timeline and audit trail both reflect resolution

## Migration Path

### Prisma Migrations

1. Add `type`, `parentId`, `status` (enum), `risk`, `priority`, `ownerId`, `executorType`, `executorId`, `dueDate`, `progress`, `sourceMode` to `WorkItem`. Set defaults for existing rows (status = 'open', type = 'task').
2. Create `Dependency` table.
3. Create `Blocker` table.
4. Create `Decision` table.

### Data Integrity

- No data loss; existing work items become `type='task'`, `status='open'`.
- `Approval` records on stage gates are kept as-is; become decision *outcomes* via new link (to be added in a future migration if Decision is linked to Approval).

## Non-Goals for This Slice

- Constitution versioning (Slice 2)
- Clarify & Analyze stages (Slice 2)
- Sandboxed code execution (Slice 3)
- Agent registry & routing (Slice 3)
- Connector webhooks (Slice 4)
- Evidence entity & evidence-driven completion (Slice 5)
- Hierarchical config (Slice 6)
