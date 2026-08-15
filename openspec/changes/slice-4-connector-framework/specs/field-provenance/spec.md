## Purpose

Answers "where did this value come from?" for any synced work-item field —
recording the source system, external id, actor, and timestamp behind the
value currently in place, and surfacing that in the UI.

## ADDED Requirements

### Requirement: Every synced field write records its provenance
The system SHALL record, for each work-item field a sync writes, the source
(the connector/system that supplied it), the external id it came from, the
actor responsible (the sync itself, distinct from a human), and the
timestamp of the write.

#### Scenario: A sync writes a field
- **WHEN** a sync updates a work item's title, description, or status from an external tracker
- **THEN** the field's provenance is recorded identifying the source connector, the external id, and the timestamp of the write

### Requirement: A manual edit records its provenance as a human actor
The system SHALL record a human-edited field's provenance identifying the
editing user and the timestamp of the edit, distinct from a sync-sourced
value.

#### Scenario: A user manually edits a synced field
- **WHEN** a write-capable user edits a work-item field that was previously set by a sync
- **THEN** the field's provenance now identifies that user as the actor, with the edit's timestamp

### Requirement: Provenance is visible per field in the UI
The system SHALL let any read-capable role see a field's provenance —
source, actor, and timestamp — on any work-item field that has one.

#### Scenario: Viewing where a field's value came from
- **WHEN** a user with read access to a work item inspects a field that has provenance recorded
- **THEN** they see its source (sync or a named human), and the timestamp of the value currently shown

### Requirement: A field with no recorded provenance is shown as such
The system SHALL NOT fabricate provenance for a field that predates this
capability or was never touched by a tracked write.

#### Scenario: A pre-existing field has no provenance record
- **WHEN** a user inspects a field with no recorded provenance (e.g. set before this capability existed)
- **THEN** the UI shows it as having no recorded origin, rather than guessing or defaulting to a misleading source
