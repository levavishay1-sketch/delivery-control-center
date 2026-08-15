# work-item-model Specification

## Purpose
Gives a work item a rich delivery shape — type, status, risk, priority,
ownership, execution model, due date, progress, and hierarchy — so it can
carry real delivery state instead of a synced-but-unused free-text status.

## Requirements

### Requirement: Work items carry a typed delivery shape
The system SHALL extend `WorkItem` with `type` (`PROJECT`/`TASK`/`BUG`/
`CHANGE`), a 9-state `status` enum, `risk` and `priority`
(`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), `ownerId`/`executorId` (nullable FKs to
`User`), `executorType` (`HUMAN`/`AI_AGENT`/`HYBRID`/`UNASSIGNED`),
`dueDate`, `progress` (0–100), and `aiCost`. `source` (the existing
integration-origin field) continues to serve the role a separate
`sourceMode` field would have played; it is not duplicated.

#### Scenario: A work item is created with defaults
- **WHEN** a work item is created without explicit type/risk/priority
- **THEN** it is created with `type=TASK`, `risk=MEDIUM`, `priority=MEDIUM`, `status=OPEN`, `progress=0`, and `ownerId` set to the creator

#### Scenario: A work item is created with explicit fields
- **WHEN** a work item is created with an explicit `type`, `risk`, `priority`, and `ownerId`
- **THEN** those values are persisted instead of the defaults

### Requirement: Status changes go through a dedicated, validated command
The system SHALL expose status changes only through `updateWorkItemStatus`,
never through the general `updateWorkItem` field-update command, and SHALL
validate every transition against a fixed state machine.

#### Scenario: A valid transition succeeds
- **WHEN** a work item in `OPEN` status is moved to `IN_PROGRESS`
- **THEN** the transition succeeds and an audit event records the old and new status

#### Scenario: An invalid transition is rejected
- **WHEN** a work item in `OPEN` status is moved directly to `COMPLETED`
- **THEN** the request is rejected with a validation error and the status is unchanged

#### Scenario: A terminal status cannot be reopened
- **WHEN** a work item in `COMPLETED` status is moved to any other status
- **THEN** the request is rejected

### Requirement: BLOCKED and DECISION_REQUIRED are reachable only as side effects
The system SHALL make the `BLOCKED` and `DECISION_REQUIRED` statuses
unreachable from `updateWorkItemStatus` in either direction. Entering them
is a side effect of creating a blocker or decision; leaving them is a side
effect of resolving that blocker or approving/rejecting that decision.

#### Scenario: Manual entry into BLOCKED is rejected
- **WHEN** a caller attempts `updateWorkItemStatus` with `newStatus=BLOCKED`
- **THEN** the request is rejected, regardless of the work item's current status

### Requirement: Work items can be organized into a parent/child hierarchy
The system SHALL allow one work item to be designated the parent of
another within the same project, and SHALL reject a change that would
create a cycle or make an item its own parent.

#### Scenario: A valid parent assignment succeeds
- **WHEN** `addParentWorkItem` is called with a child and parent in the same project, and the parent is not a descendant of the child
- **THEN** the child's `parentId` is set and an audit event is recorded

#### Scenario: A self-parent is rejected
- **WHEN** `addParentWorkItem` is called with the same work item as both child and parent
- **THEN** the request is rejected

#### Scenario: A cycle is rejected
- **WHEN** `addParentWorkItem` would make an item a child of one of its own descendants
- **THEN** the request is rejected, checked by walking the full ancestor chain

### Requirement: Editable fields exclude status
The system SHALL allow `updateWorkItem` to change title, description,
risk, priority, owner, executor, due date, and progress, but SHALL exclude
status from that command's allowed fields.

#### Scenario: A non-status field is updated
- **WHEN** `updateWorkItem` is called with a new `progress` value
- **THEN** the work item's progress is updated and an audit event records the change

### Requirement: External sync maps free-text status onto the fixed enum
The system SHALL map an externally-synced work item's free-text status
(e.g. Jira's) onto the 9-state `WorkStatus` enum, defaulting any
unrecognized value to `OPEN` rather than rejecting the sync.

#### Scenario: An unrecognized external status defaults to OPEN
- **WHEN** a synced work item reports a status string not in the known mapping table
- **THEN** the work item is created or updated with `status=OPEN`
