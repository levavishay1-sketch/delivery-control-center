# Spec: Blocker Entity

## Overview

A blocker is a first-class entity representing an impediment to progress. It captures *why* a work item or stage is stalled, who owns unblocking it, and what action is required.

## Required Behavior

### Data Schema

`Blocker` (new model):
- **`id`** (PK)
- **`blockingItemId`** (FK to WorkItem): the work item that is blocked.
- **`ownerId`** (FK to User): the person responsible for resolving the blocker.
- **`reason`** (string): plain-language explanation of the blockage. E.g., "Waiting for design approval from UX team", "License compliance review in progress".
- **`requiredAction`** (string): the action needed to unblock. E.g., "Approve the Figma designs", "Complete compliance checklist".
- **`blockedSince`** (datetime): when the blocker was created.
- **`impact`** (string, optional): business or technical impact of the blockage. E.g., "Blocks release by 3 days", "Prevents rollout to production".
- **`resolvedAt`** (nullable datetime): when the blocker was resolved. Null while active.
- **`createdAt`**, **`updatedAt`** (datetime).

### Commands

**`createBlocker(input: CreateBlockerInput)`**
- Input: `blockingItemId`, `reason`, `requiredAction`, `ownerId`, `impact` (optional).
- Validation: `blockingItemId` must exist; `ownerId` must be a user in the same client.
- Authorization: Project Manager+; Owner can create their own blockers.
- Side effect: set the work item's `status='blocked'` if it isn't already.
- Transaction: insert `Blocker`, update work item status, record `BLOCKER_CREATED` audit event.
- Return: created `Blocker`.

**`updateBlocker(id: string, input: Partial<UpdateBlockerInput>)`**
- Allowed fields: `reason`, `requiredAction`, `impact`, `ownerId`.
- Authorization: only owner or Project Manager+ can update.
- Transaction: update, record `BLOCKER_UPDATED` audit event.
- Return: updated `Blocker`.

**`resolveBlocker(id: string, resolutionNote?: string)`**
- Mark the blocker as resolved.
- Validation: must exist and `resolvedAt` must be null.
- Authorization: Blocker owner or Manager+.
- Side effect: if no other active blockers exist on the work item, restore its `status` to 'open' (or the last non-blocked status).
- Transaction: set `resolvedAt=now()`, update work item status, record `BLOCKER_RESOLVED` audit event.
- Return: updated `Blocker`.

### Queries

**`getActiveBlockers(workItemId: string): Blocker[]`**
- List all active (unresolved) blockers for a work item.

**`getAllActiveBlockers(projectId: string): Blocker[]`**
- List all active blockers in a project (for Attention Center).

**`getBlocker(id: string): Blocker`**
- Read single blocker.

### Constraints

- A work item cannot transition from `blocked` status while any blocker is active (enforced by `updateWorkItemStatus`).
- Every blocker must have a reason and required action (never empty strings).
- `ownerId` must be a valid user in the work item's client.
- `resolvedAt` is set only by `resolveBlocker` command; never manually updated.

### UI Rendering

**Blocker Panel** (Quick View drawer, Attention Center row):
- **Title**: "Blocked — [reason]" (prominently displayed).
- **Details**: required action, owner (as user name), blocked since (duration, e.g., "2 days ago"), impact (if present).
- **Actions**: "Resolve Blocker" button (available to owner or Manager+).
- **Never render without context**: blocker reason and required action are always visible.

**Attention Center Group**: "Blockers" (separate from Decisions and Risks). Each row:
- Work item title, type, owner.
- Reason, required action, blocker owner.
- "Resolve" button if authorized.

## Acceptance Criteria

- ✅ Prisma migration creates `Blocker` table.
- ✅ `createBlocker` command sets work item status to `blocked`.
- ✅ `resolveBlocker` command clears `resolvedAt`, restores status to 'open' or prior state.
- ✅ A work item cannot transition out of `blocked` while a blocker is active (validation error).
- ✅ All blockers in a project appear in Attention Center "Blockers" group.
- ✅ Blocker reason and required action are displayed in Quick View and Attention Center rows.
- ✅ Tests cover: create, update, resolve, authorization checks, status side effects.
- ✅ E2E test: create blocker, verify Attention Center appearance, resolve, verify audit trail and status change.
