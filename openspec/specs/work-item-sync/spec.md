# work-item-sync Specification

## Purpose
Brings work into the system, either pulled from an external tracker or
entered by hand, and starts a delivery pipeline for each item automatically
so nothing sits untracked.

## Requirements

### Requirement: Manually created work items start a pipeline
The system SHALL create a pipeline for a work item as soon as it is created
manually, starting at the first configured stage.

#### Scenario: Adding a work item by hand
- **WHEN** a work item is created manually for a project
- **THEN** a pipeline is created for it immediately, starting at the first configured stage

### Requirement: Syncing an integrated project creates or updates work items
The system SHALL create or update a work item for each item returned by a
project's configured integration when it is synced, matching existing items
by their external id within that project.

#### Scenario: Syncing a project configured for an external tracker
- **WHEN** a project configured for an external integration (e.g. Jira) is synced
- **THEN** each item from that system is created as a new work item, or updated if it already exists, matched by its external id within that project

#### Scenario: New work items from a sync get a pipeline
- **WHEN** a sync creates a work item that has no pipeline yet
- **THEN** a pipeline is created for it, starting at the first configured stage

### Requirement: Each work item has at most one pipeline
The system SHALL NOT create more than one pipeline for the same work item.

#### Scenario: Re-syncing an already-tracked item does not create a second pipeline
- **WHEN** a sync updates a work item that already has a pipeline
- **THEN** no additional pipeline is created for that work item

### Requirement: An unconfigured integration fails clearly instead of syncing partially
The system SHALL refuse to sync a project whose integration is not fully
configured, and SHALL NOT create or update any work items as a side effect
of the failed attempt.

#### Scenario: Syncing without required integration configuration
- **WHEN** a sync is requested for a project whose integration credentials or target are not configured
- **THEN** the sync fails with an error identifying what configuration is missing, and no work items are created or updated

### Requirement: An integration type with no real adapter is explicitly unavailable
The system SHALL NOT silently substitute a different adapter for an
integration type that has no real implementation. It SHALL reject a sync
attempt for such a project with an error naming the integration as not yet
available, and SHALL NOT offer that integration type as selectable in the
UI until it is implemented.

#### Scenario: Syncing a project configured for an unimplemented integration
- **WHEN** a project's integration type has no real adapter (e.g. Azure DevOps)
- **THEN** the sync fails with an error stating that integration is not yet available, rather than silently running the manual adapter
