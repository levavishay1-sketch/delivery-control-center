# blocker Specification

## Purpose
Captures *why* a work item is stalled as a first-class record — reason,
owner, required action — with its creation and resolution driving the work
item's own status, so "blocked" always carries an explanation.

## Requirements

### Requirement: Creating a blocker forces the work item into BLOCKED
The system SHALL, when a blocker is created on a work item, set that work
item's status to `BLOCKED` in the same transaction as the blocker insert,
and SHALL record an audit event naming the blocked item and the reason.

#### Scenario: A blocker is created
- **WHEN** `createBlocker` is called with a reason, required action, and owner for an open work item
- **THEN** the blocker is created, the work item's status becomes `BLOCKED`, and an audit event records the reason

### Requirement: Resolving a blocker restores status only when no other blocker is active
The system SHALL, when a blocker is resolved, set its `resolvedAt`, and
SHALL restore the work item's status to `OPEN` only if no other unresolved
blocker remains on that item — otherwise the item stays `BLOCKED`.

#### Scenario: Resolving the only active blocker restores status
- **WHEN** `resolveBlocker` is called on a work item's only active blocker
- **THEN** the blocker's `resolvedAt` is set and the work item's status returns to `OPEN`

#### Scenario: Resolving one of several active blockers leaves status unchanged
- **WHEN** `resolveBlocker` is called on one of two active blockers on the same work item
- **THEN** that blocker is resolved but the work item's status remains `BLOCKED` until the remaining blocker is also resolved

#### Scenario: Resolving an already-resolved blocker is rejected
- **WHEN** `resolveBlocker` is called on a blocker whose `resolvedAt` is already set
- **THEN** the request is rejected with a validation error

### Requirement: Blocker mutation requires write access or ownership
The system SHALL require write-capable role access to create a blocker,
and SHALL allow either the blocker's owner or a write-capable role to
update or resolve it.

#### Scenario: A read-only role cannot create a blocker
- **WHEN** a user with only viewer access on the client attempts to create a blocker
- **THEN** the request is rejected

#### Scenario: The blocker's owner can resolve it without a manager role
- **WHEN** the blocker's designated owner (who does not hold a write-capable role) calls `resolveBlocker`
- **THEN** the resolution succeeds

### Requirement: A blocker's reason and required action are never empty
The system SHALL require a non-empty `reason` and `requiredAction` on
every blocker; `impact` is optional.

#### Scenario: Creating a blocker without a reason is rejected
- **WHEN** `createBlocker` is called with an empty `reason`
- **THEN** the request is rejected with a validation error
