## Purpose

Represents a project's connection to one external work-item tracker as a
first-class, inspectable resource — its mode, auth, capabilities, and
health — and tracks every sync attempt against it as a `SyncRun`, replacing
the previous bare `Project.integrationType`/`integrationConfig` fields with
a real connection lifecycle.

## ADDED Requirements

### Requirement: A project connects to an external tracker through a Connector
The system SHALL represent a project's connection to an external work-item
tracker as a `Connector` record scoped to that project, holding its `mode`
(e.g. pull/push), `authType`, `syncMode`, `capabilities`, `status`
(`CONNECTED`/`DISCONNECTED`/`ERROR`), and `lastSyncAt`. A project's manual
(no external tracker) mode is represented the same way — a `Connector` with
no external adapter — so every project has exactly one current connector
state.

#### Scenario: Configuring a project's external tracker creates a Connector
- **WHEN** a write-capable user configures an external tracker (e.g. Jira, Azure DevOps, GitHub) for a project
- **THEN** a `Connector` record is created or updated for that project recording its type, auth, and capabilities, with `status: CONNECTED`

#### Scenario: A project with no external tracker still has a connector record
- **WHEN** a project is created without configuring an external tracker
- **THEN** its connector state reads as manual, with no adapter-specific configuration required

### Requirement: Every sync attempt creates a SyncRun
The system SHALL create one `SyncRun` record for every sync attempt against
a project's `Connector` — manual trigger or webhook-triggered — recording
its status, start/completion timestamps, and per-item counts (created,
updated, conflicted).

#### Scenario: A manual sync creates a SyncRun
- **WHEN** a user triggers a sync for a project with a connected external tracker
- **THEN** a `SyncRun` record is created for that attempt, updated with final status and item counts once the sync completes or fails

#### Scenario: A failed sync records the failure on its SyncRun
- **WHEN** a sync attempt fails (adapter error, auth failure, or exhausted retries)
- **THEN** its `SyncRun` is marked failed with an error detail, and the project's `Connector.status` reflects the failure

### Requirement: Sync history is visible per project
The system SHALL make a project's `SyncRun` history visible to any
read-capable role, most recent first, including status, item counts, and
timing for each attempt.

#### Scenario: Viewing sync history
- **WHEN** a user with read access to a project views its connector settings
- **THEN** they see every past `SyncRun` for that project's connector, in reverse chronological order

### Requirement: Transient adapter failures are retried with backoff
The system SHALL retry a sync attempt that fails with a transient adapter
error (e.g. network timeout, rate limit) with exponential backoff, up to a
configured attempt limit, before marking the `SyncRun` permanently failed.

#### Scenario: A transient failure is retried and then succeeds
- **WHEN** an adapter call fails with a transient error and a retry attempt remains
- **THEN** the sync is retried after a backoff delay, and succeeds without requiring a new manual trigger

#### Scenario: Retries are exhausted
- **WHEN** every retry attempt for a sync fails
- **THEN** the `SyncRun` is marked permanently failed with the last error recorded, and the connector's `status` reflects the failure

### Requirement: An unimplemented connector type is explicitly unavailable
The system SHALL NOT silently substitute a different adapter for a
connector type that has no real implementation. It SHALL reject
configuration or sync of such a connector with an error naming the type as
not yet available, and SHALL NOT offer it as selectable in the UI until
implemented.

#### Scenario: Configuring an unimplemented connector type
- **WHEN** a user attempts to configure a project's connector for a type with no real adapter
- **THEN** the attempt is rejected with an error stating that type is not yet available
