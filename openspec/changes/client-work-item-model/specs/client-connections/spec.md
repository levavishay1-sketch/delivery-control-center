## Purpose

Gives a Client a simple, freely-addable, client-level list of technical Connections to external
sources/services — deliberately distinct from `Connector` (the Project-scoped sync-engine object
that already exists for GitHub/Jira/Azure DevOps sync/webhook machinery, which stays unchanged and
internal). A Connection is what a Work Item's `source` field conceptually points at, but a Work
Item never selects a Connection directly.

## ADDED Requirements

### Requirement: A Connection is a simple, client-level object with a Source and a Name

The system SHALL allow a write-capable user to create a `Connection` owned by a client, with a
`source` (a free-form, extensible value — e.g. Azure DevOps, Jira, GitHub, MCP, CLI, or any other
future source) and a `name`, both required. The system SHALL NOT require or accept credentials,
authentication configuration, sync configuration, or any other advanced configuration on a
Connection at this stage.

#### Scenario: Creating a Connection with only Source and Name
- **WHEN** a write-capable user submits the Connection creation form with a `source` and `name`
- **THEN** a `Connection` is created for that client and appears in its CONNECTIONS section

#### Scenario: A read-only user cannot create a Connection
- **WHEN** a user without write access to the client attempts to create a Connection
- **THEN** the request is refused

### Requirement: A Connection is viewable, editable, and deletable from a dedicated detail screen

The system SHALL provide a dedicated Connection detail screen showing its Source and Name,
allowing a write-capable user to edit and save both, and to delete the Connection after an explicit
confirmation.

#### Scenario: Editing a Connection
- **WHEN** a write-capable user changes a Connection's Name and saves
- **THEN** the Connection's Name is updated

#### Scenario: Deleting a Connection requires confirmation
- **WHEN** a write-capable user selects delete on a Connection
- **THEN** they are asked to confirm before the Connection is removed

### Requirement: A Connection is never selected when creating a Work Item

The system SHALL NOT offer Connection selection on the Work Item creation screen. A Work Item's
`source` field identifies its origin independently of any Connection; the same Connection may
relate to many Work Items sharing that Source, but no direct Work Item-to-Connection link is
stored.

#### Scenario: The Work Item creation form has no Connection field
- **WHEN** a write-capable user opens the Work Item creation screen
- **THEN** they see a Source field but no Connection field
