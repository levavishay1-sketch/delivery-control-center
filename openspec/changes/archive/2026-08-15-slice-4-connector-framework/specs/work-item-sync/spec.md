## MODIFIED Requirements

### Requirement: Syncing an integrated project creates or updates work items
The system SHALL create or update a work item for each item returned by a
project's connected connector when it is synced, matching existing items by
their external id within that project, recording provenance for every field
written and deferring to conflict resolution instead of overwriting a
human-edited field that disagrees with the incoming value.

#### Scenario: Syncing a project configured for an external tracker
- **WHEN** a project with a connected external connector (e.g. Jira, Azure DevOps, GitHub) is synced
- **THEN** each item from that system is created as a new work item, or updated if it already exists, matched by its external id within that project, with provenance recorded for every field written

#### Scenario: New work items from a sync get a pipeline
- **WHEN** a sync creates a work item that has no pipeline yet
- **THEN** a pipeline is created for it, starting at the first configured stage

#### Scenario: A field with a conflicting manual edit is not overwritten
- **WHEN** a sync would write a value to a field whose provenance shows it was last set by a human edit, and the incoming value differs
- **THEN** the field's current manual value is left unchanged and a conflict is surfaced instead of applying the sync's value

### Requirement: An unconfigured integration fails clearly instead of syncing partially
The system SHALL refuse to sync a project whose connector is not fully
configured or not connected, and SHALL NOT create or update any work items
as a side effect of the failed attempt.

#### Scenario: Syncing without required integration configuration
- **WHEN** a sync is requested for a project whose connector is not connected or missing required configuration
- **THEN** the sync fails with an error identifying what is missing, and no work items are created or updated, and the `SyncRun` records the failure

### Requirement: An integration type with no real adapter is explicitly unavailable
The system SHALL NOT silently substitute a different adapter for a
connector type that has no real implementation. It SHALL reject a sync
attempt for such a project with an error naming the integration as not yet
available, and SHALL NOT offer that integration type as selectable in the
UI until it is implemented.

#### Scenario: Syncing a project configured for an unimplemented integration
- **WHEN** a project's connector type has no real adapter
- **THEN** the sync fails with an error stating that integration is not yet available, rather than silently running the manual adapter
