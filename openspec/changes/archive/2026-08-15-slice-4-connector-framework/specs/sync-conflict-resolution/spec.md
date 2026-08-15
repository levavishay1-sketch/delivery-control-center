## Purpose

Protects a human's manual edit from being silently overwritten by a later
external sync: when the two disagree, the manual value wins by default and
the disagreement is surfaced for explicit human review, never applied
without one.

## ADDED Requirements

### Requirement: A sync never silently overwrites a human-edited field
The system SHALL NOT overwrite a work-item field's current value with an
incoming synced value when that field's provenance shows it was last set by
a human edit and the incoming value differs. It SHALL instead create a
surfaced conflict record and leave the field's current (manual) value in
place.

#### Scenario: A sync would overwrite a manually edited field with a different value
- **WHEN** a sync fetches a value for a field whose provenance shows a human last edited it, and the incoming value differs from the current value
- **THEN** the current manual value is left unchanged, and a conflict is recorded for that field naming the incoming value and its source

#### Scenario: A sync's incoming value matches the current manual value
- **WHEN** a sync fetches a value for a manually-edited field that happens to match the current value
- **THEN** no conflict is created, since there is nothing to disagree about

#### Scenario: A sync updates a field with no manual edit on record
- **WHEN** a sync fetches a value for a field whose provenance shows it was itself last set by a sync (no intervening human edit)
- **THEN** the field is updated normally, with no conflict

### Requirement: Conflicts are visible and resolvable by a write-capable role
The system SHALL let a write-capable role see every open conflict for a
project's work items and explicitly resolve each one by keeping the manual
value or accepting the incoming synced value.

#### Scenario: Viewing open conflicts
- **WHEN** a write-capable user views a project's conflicts
- **THEN** they see every field with an unresolved conflict, its current (manual) value, and the incoming synced value that was withheld

#### Scenario: Resolving a conflict by keeping the manual value
- **WHEN** a write-capable user resolves a conflict by keeping the manual value
- **THEN** the field is unchanged, the conflict is marked resolved, and the resolution is recorded in the audit trail

#### Scenario: Resolving a conflict by accepting the incoming value
- **WHEN** a write-capable user resolves a conflict by accepting the incoming synced value
- **THEN** the field is updated to the incoming value, its provenance now shows the sync as the source, the conflict is marked resolved, and the resolution is recorded in the audit trail

### Requirement: An unresolved conflict does not block subsequent syncs
The system SHALL continue syncing every other field and work item normally
while a conflict remains unresolved; only the conflicted field itself stays
withheld from further sync writes until resolved.

#### Scenario: A later sync while a conflict is still open
- **WHEN** a project is synced again while an earlier conflict for one of its fields is still unresolved
- **THEN** every other field syncs normally, and the still-conflicted field is left untouched (its existing conflict is not duplicated if the incoming value is unchanged)
