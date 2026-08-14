# Spec: Decision Entity

## Overview

A decision is a first-class entity representing a question requiring human judgment. It captures the question, AI recommendation, deadline, and approval outcome. On stage gates, existing `Approval` records become decision *outcomes*.

## Required Behavior

### Data Schema

`Decision` (new model):
- **`id`** (PK)
- **`workItemId`** (FK to WorkItem)
- **`question`** (string): the decision to be made. E.g., "Proceed with current risk assessment?", "Accept this architecture proposal?"
- **`reason`** (string): why this decision is needed.
- **`impact`** (string): business/technical consequence if the decision is delayed or made wrongly.
- **`aiRecommendation`** (string, optional): AI's suggested answer or recommendation.
- **`aiConfidence`** (decimal 0–100, optional): confidence score (0=guess, 100=certain).
- **`deadline`** (nullable datetime): when the decision must be made.
- **`approverId`** (nullable FK to User): who made the decision (set only after approval/rejection).
- **`status`** (enum): open, approved, rejected. Defaults to 'open'.
- **`createdAt`**, **`updatedAt`** (datetime).
- **`resolvedAt`** (nullable datetime): when the decision was made.

### Commands

**`createDecision(input: CreateDecisionInput)`**
- Input: `workItemId`, `question`, `reason`, `impact`, `aiRecommendation` (optional), `aiConfidence` (optional), `deadline` (optional).
- Validation: `workItemId` must exist.
- Authorization: Project Manager+ or the work item owner.
- Side effect: set work item `status='decision_required'` if not already.
- Transaction: insert `Decision`, update work item status, record `DECISION_CREATED` audit event.
- Return: created `Decision`.

**`approveDecision(id: string, approverId: string, comment?: string)`**
- Approve the decision.
- Validation: must exist and `status='open'`.
- Authorization: any authenticated user (anyone can approve, but it's recorded who did).
- Side effect: restore work item `status` to 'open' or 'in_progress' (or next logical state).
- Transaction: set `status='approved'`, `approverId`, `resolvedAt=now()`, record `DECISION_APPROVED` audit event.
- Return: updated `Decision`.

**`rejectDecision(id: string, rejectorId: string, reason: string)`**
- Reject the decision and request re-evaluation.
- Validation: must exist and `status='open'`.
- Authorization: any authenticated user.
- Side effect: work item `status` stays `decision_required`.
- Transaction: set `status='rejected'`, `approverId=rejectorId`, `resolvedAt=now()`, record `DECISION_REJECTED` audit event with rejection reason.
- Return: updated `Decision`.

### Queries

**`getPendingDecisions(projectId: string): Decision[]`**
- List all open decisions in a project (for Attention Center).

**`getWorkItemDecision(workItemId: string): Decision | null`**
- Get the current decision for a work item (if any).

**`getDecision(id: string): Decision`**
- Read single decision.

### Constraints

- A work item cannot transition from `decision_required` while a decision is open.
- Every decision must have a question and reason.
- `deadline`, `aiRecommendation`, and `aiConfidence` are optional but recommended.
- A decision is resolved (approved or rejected) only via explicit commands; `resolvedAt` is never manually set.

### UI Rendering

**Decision Panel** (Quick View drawer, Attention Center row):
- **Title**: "Decision — [question]" (prominently displayed).
- **Details**: reason, impact, AI recommendation (if present) with confidence score, deadline (if present).
- **Actions**: "Approve" and "Reject" buttons (available to any authenticated user if permitted by role). Approval/rejection is recorded as audit event.
- **Never render without context**: decision question, reason, and impact are always visible before action buttons.

**Attention Center Group**: "Decisions" (separate from Blockers). Each row:
- Work item title, type, owner.
- Decision question, reason, deadline (if approaching).
- "Approve" and "Reject" buttons.
- AI recommendation with confidence (if present).

## Acceptance Criteria

- ✅ Prisma migration creates `Decision` table.
- ✅ `createDecision` command sets work item status to `decision_required`.
- ✅ `approveDecision` and `rejectDecision` commands update status and `resolvedAt`.
- ✅ A work item cannot transition out of `decision_required` while a decision is open (validation error).
- ✅ All pending decisions appear in Attention Center "Decisions" group.
- ✅ Decision question, reason, impact, and recommendation are displayed in Quick View and Attention Center rows.
- ✅ Approval/rejection buttons are only shown if authorized and decision is open.
- ✅ Tests cover: create, approve, reject, authorization checks, status side effects, AI recommendation display.
- ✅ E2E test: create decision, verify Attention Center, approve, verify audit trail and status change.
