# decision Specification

## Purpose
Captures a question requiring human judgment as a first-class record —
distinct from a pipeline stage's `Approval` outcome — with its creation
and resolution driving the work item's own status.

## Requirements

### Requirement: Creating a decision forces the work item into DECISION_REQUIRED
The system SHALL, when a decision is created on a work item, set that work
item's status to `DECISION_REQUIRED` in the same transaction as the
decision insert.

#### Scenario: A decision is created
- **WHEN** `createDecision` is called with a question, reason, and impact for a work item
- **THEN** the decision is created with `status=OPEN`, the work item's status becomes `DECISION_REQUIRED`, and an audit event records the question

### Requirement: Approving a decision restores the work item's status
The system SHALL, when a decision is approved, set its `status=APPROVED`,
its `approverId` and `resolvedAt`, and SHALL restore the work item's
status to `OPEN`.

#### Scenario: A decision is approved
- **WHEN** `approveDecision` is called on an open decision
- **THEN** the decision's status becomes `APPROVED`, the approver and timestamp are recorded, and the work item's status returns to `OPEN`

### Requirement: Rejecting a decision leaves the work item status unchanged
The system SHALL, when a decision is rejected, set its `status=REJECTED`
and `resolvedAt`, but SHALL leave the work item's status at
`DECISION_REQUIRED`.

#### Scenario: A decision is rejected
- **WHEN** `rejectDecision` is called on an open decision, optionally with a reason
- **THEN** the decision's status becomes `REJECTED` and the work item's status remains `DECISION_REQUIRED`

### Requirement: Any authenticated user may approve or reject an open decision
The system SHALL allow any authenticated user with at least read access to
the decision's client — not only write-capable roles — to approve or
reject it, since the act of deciding is itself the recorded event.
Creating a decision, by contrast, requires a write-capable role.

#### Scenario: A viewer-role user can approve a decision
- **WHEN** a user with only viewer access on the client calls `approveDecision` on an open decision
- **THEN** the approval succeeds and records that user as the approver

#### Scenario: A viewer-role user cannot create a decision
- **WHEN** a user with only viewer access attempts `createDecision`
- **THEN** the request is rejected

### Requirement: A decision cannot be resolved twice
The system SHALL reject `approveDecision` or `rejectDecision` when the
decision's status is not `OPEN`.

#### Scenario: Approving an already-resolved decision is rejected
- **WHEN** `approveDecision` is called on a decision whose status is already `APPROVED` or `REJECTED`
- **THEN** the request is rejected with a validation error
