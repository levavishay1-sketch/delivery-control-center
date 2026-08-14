## ADDED Requirements

### Requirement: An integration type with no real adapter is explicitly unavailable
The system SHALL NOT silently substitute a different adapter for an
integration type that has no real implementation. It SHALL reject a sync
attempt for such a project with an error naming the integration as not yet
available, and SHALL NOT offer that integration type as selectable in the
UI until it is implemented.

#### Scenario: Syncing a project configured for an unimplemented integration
- **WHEN** a project's integration type has no real adapter (e.g. Azure DevOps)
- **THEN** the sync fails with an error stating that integration is not yet available, rather than silently running the manual adapter
