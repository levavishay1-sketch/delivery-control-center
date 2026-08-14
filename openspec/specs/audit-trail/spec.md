# audit-trail Specification

## Purpose
Gives every decision, AI draft, approval, rejection, and sync a permanent,
ordered, human-readable record, so delivery through the system is auditable
end-to-end after the fact.

## Requirements

### Requirement: Every pipeline transition is recorded as an audit event
The system SHALL record an audit event for every pipeline lifecycle
transition: pipeline creation, a stage being drafted, a stage approval, a
stage rejection, the pipeline advancing to its next stage, pipeline
completion, and a work-item sync from an external system. Each event SHALL
record who or what performed it (system, AI, or a named human), a
human-readable description of the action, and when it happened.

#### Scenario: An AI draft is recorded with attribution
- **WHEN** a stage is drafted
- **THEN** an audit event is recorded identifying the AI as the actor and describing which stage was drafted

#### Scenario: A human decision is recorded with the approver's name
- **WHEN** a human approves or rejects a stage's gate
- **THEN** an audit event is recorded identifying that person by name and the decision they made

### Requirement: Audit events commit atomically with the change they describe
An audit event SHALL never be persisted without the state change it
describes actually taking effect, and vice versa.

#### Scenario: A failed transition leaves no orphaned audit event
- **WHEN** a pipeline state transition fails partway through
- **THEN** neither the state change nor its audit event is persisted

### Requirement: The audit trail is viewable in chronological order
The system SHALL present audit events in reverse-chronological order (most
recent first) when a user views the audit trail.

#### Scenario: Viewing the audit trail
- **WHEN** a user opens the audit trail view
- **THEN** events are displayed newest first, each showing its actor, action, and timestamp
