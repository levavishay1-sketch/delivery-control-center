# Spec: Work Item Model Extension

## Overview

Extend `WorkItem` from a flat, undifferentiated model to a rich tracking entity that captures type, status, risk, priority, ownership, execution model, and progress. The `status` field moves from a free string (synced from Jira, never displayed) to a proper 9-state enum.

## Required Behavior

### Data Schema

`WorkItem` gains these fields:

- **`type`** (enum): project, task, bug, change. Immutable at creation; displayed in lists and detail views.
- **`parentId`** (nullable FK to WorkItem): allows hierarchical decomposition. A task can be a child of a project or another task.
- **`status`** (enum, replaces free string): one of 9 states: draft, open, in_progress, decision_required, blocked, review, approved, completed, closed. Default on creation: 'open'. Rendered everywhere the work item appears.
- **`risk`** (categorical enum): Low, Medium, High, Critical. Displayed with a visual indicator and explanation on the 360° record and Attention Center.
- **`priority`** (categorical enum): Low, Medium, High, Critical. Displayed in lists and detail views.
- **`ownerId`** (FK to User): the person responsible for the work item. Defaults to the creator. Rendered as "Owned by [name]".
- **`executorType`** (enum): human, ai-agent, hybrid, unassigned. Indicates who/what will execute the work.
- **`executorId`** (nullable FK to User): the assigned executor (if human or hybrid). Can be empty.
- **`dueDate`** (nullable datetime): when the work item must be complete. Rendered on the work item detail and in the Attention Center if within 7 days (triggers "Deadline" attention group).
- **`progress`** (int, 0–100): completion percentage. Rendered on work item detail and in a summary card. Defaults to 0.
- **`sourceMode`** (enum): jira, azure-devops, github, manual. Indicates origin. Preserved during sync; set to 'manual' for user-created items.
- **`aiCost`** (decimal): token/cost from drafting in the SDD pipeline. Accumulated over all runs; displayed in cost breakdown on the 360° record.

### Commands

**`createWorkItem(input: CreateWorkItemInput)`**
- Input: `projectId`, `type`, `title`, `description`, `ownerId`, `parentId` (optional), `dueDate` (optional), `risk` (optional, defaults to Medium), `priority` (optional, defaults to Medium), `executorType` (optional, defaults to unassigned), `executorId` (optional).
- Validation: Zod schema checks all fields; `projectId` must exist; `ownerId` must be a user in the project's client; `parentId`, if set, must be a work item in the same project.
- Authorization: only Project Manager or higher in the project's client.
- Transaction: insert `WorkItem` with `status='open'`, `progress=0`, `sourceMode='manual'`; record audit event `WORK_ITEM_CREATED`.
- Return: created `WorkItem`.

**`updateWorkItem(id: string, input: Partial<UpdateWorkItemInput>)`**
- Allowed fields: `title`, `description`, `status`, `risk`, `priority`, `ownerId`, `executorType`, `executorId`, `dueDate`, `progress`.
- Validation: Zod checks each field; status transitions follow the state machine (see design.md). Prevent invalid transitions, e.g., from `completed` to `draft`.
- Authorization: only the owner or a Manager can update; a Viewer cannot change status.
- Transaction: update `WorkItem`, record `WORK_ITEM_UPDATED` audit event with the changed fields.
- Return: updated `WorkItem`.

**`updateWorkItemStatus(id: string, newStatus: WorkStatus, reason?: string)`**
- Transition the work item to a new status.
- Validation: check the status state machine; disallow blocked→approved without resolving the blocker; disallow decision_required→* without resolving the decision.
- Authorization: role-based (Manager+ can change status; Executor can advance in_progress→review; Approver can approve).
- Transaction: update status, record `WORK_ITEM_STATUS_CHANGED` audit event with old and new status and reason.
- Return: updated `WorkItem`.

**`addParentWorkItem(childId: string, parentId: string)`**
- Make one work item a child of another.
- Validation: both must exist in the same project; prevent cycles (child cannot be an ancestor of parent).
- Authorization: Project Manager+.
- Transaction: update child's `parentId`, record audit event.
- Return: updated child `WorkItem`.

### Queries

**`getWorkItem(id: string): WorkItem`**
- Read single work item with all fields populated.

**`listWorkItems(projectId: string, filters?: ListFilters): WorkItem[]`**
- List work items in a project, optionally filtered by type, status, owner, priority, or parentId (children of a specific item).
- Supports pagination.

**`getWorkItemsByStatus(projectId: string, status: WorkStatus): WorkItem[]`**
- List all work items in a status (e.g., "blocked", "decision_required").

**`getWorkItemHierarchy(parentId: string): WorkItem[]`**
- List all descendants of a parent work item.

### Constraints

- Every `WorkItem` created must have an `ownerId` (inherited from creator if not explicit). Never leave it null.
- `status` is always one of the 9 enum values. Free strings are rejected.
- `ownerId` and `executorId` must be valid users in the work item's project's client. Cross-client assignment is forbidden.
- Cycles in parent-child relationships are detected and prevented at creation.
- Status transitions are guarded: a work item cannot move from `completed` back to `in_progress` (e.g., no "re-open completed").

### UI Rendering

- **Work item list (Dashboard, Attention Center)**: show type badge (color-coded), title, owner, status, due date (if within 7 days), risk (with label), priority.
- **Work item detail (360° Overview)**: all fields above, plus progress bar (0–100), executor, sourceMode, parentId (as a link), aiCost (in cost breakdown).
- **Status field**: never rendered without explanation. A status badge is always paired with a label (e.g., "Blocked" with the blocker reason, "Decision Required" with the decision question).
- **Hierarchy**: if a work item has children, show a collapsed/expandable list of children on the 360° Overview.

### Edge Cases

- **Orphaned parent**: if a parent work item is deleted, its children remain but `parentId` is nulled. Update audit events record the orphaning.
- **Executor assignment without executor type**: if `executorType='human'` but `executorId` is empty, render as "Needs assignment" (Attention Center action).
- **Status conflicts with blockers/decisions**: if a work item is moved to a new status while a blocker is active, the blocker must be resolved first (validation error). Same for decisions and status.
- **Synced work items**: if a work item is synced from Jira with a status that doesn't map to the 9 values, log a warning and default to 'open'. Preserve the original `sourceMode`.

## Acceptance Criteria

- ✅ Prisma migration adds all new fields to `WorkItem`.
- ✅ Domain commands (`createWorkItem`, `updateWorkItem`, `updateWorkItemStatus`, `addParentWorkItem`) exist, validate input, enforce authorization, and record audit events.
- ✅ Queries return properly typed `WorkItem` objects with all fields.
- ✅ Status field is rendered on all work-item displays (list, detail, 360° Record, Attention Center).
- ✅ Type field is rendered as a badge.
- ✅ Risk and Priority are rendered with labels and visual indicators.
- ✅ Owner and Executor are displayed as user names (or "Unassigned").
- ✅ Status transitions respect the state machine (no invalid transitions).
- ✅ Tests cover: create with defaults, update with role checks, status transition, invalid transitions, hierarchy cycle detection.
- ✅ E2E test: create work item with type/risk/owner, update status, verify audit trail.
