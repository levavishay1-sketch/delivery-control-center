## MODIFIED Requirements

### Requirement: A project connects to an external tracker through a Connector
The system SHALL represent a project's connection to an external work-item
tracker as a `Connector` record scoped to that project, holding its `mode`
(e.g. pull/push), `authType`, `syncMode`, `capabilities`, `status`
(`CONNECTED`/`DISCONNECTED`/`ERROR`), and `lastSyncAt`. A project's manual
(no external tracker) mode is represented the same way — a `Connector` with
no external adapter — so every project has exactly one current connector
state. Every `Connector` SHALL also be attributed to its project's `Client`
(`Connector.clientId`), so a client's connectors are queryable directly at
the client level (e.g. the Clients hub), independent of navigating through
each of its projects individually.

#### Scenario: Configuring a project's external tracker creates a Connector
- **WHEN** a write-capable user configures an external tracker (e.g. Jira, Azure DevOps, GitHub) for a project
- **THEN** a `Connector` record is created or updated for that project recording its type, auth, and capabilities, with `status: CONNECTED`

#### Scenario: A project with no external tracker still has a connector record
- **WHEN** a project is created without configuring an external tracker
- **THEN** its connector state reads as manual, with no adapter-specific configuration required

#### Scenario: A connector is attributed to its client
- **WHEN** a `Connector` exists for a project
- **THEN** it carries the `clientId` of that project's client, and appears among that client's
  connectors on the Clients hub's client detail view

### Requirement: An unimplemented connector type is explicitly unavailable
The system SHALL NOT silently substitute a different adapter for a
connector type that has no real implementation. It SHALL reject
configuration or sync of such a connector with an error naming the type as
not yet available, and SHALL NOT offer it as selectable in the UI until
implemented. This explicitly covers `IntegrationType`'s `CRM`, `TEAMS`,
`MCP`, `CUSTOM_API`, and `OTHER` values — named in the enum as
representative of the client information sources the product will support,
but not configurable or selectable until a real adapter exists for them.

#### Scenario: Configuring an unimplemented connector type
- **WHEN** a user attempts to configure a project's connector for a type with no real adapter
- **THEN** the attempt is rejected with an error stating that type is not yet available

#### Scenario: A newly named source type is not yet selectable
- **WHEN** a user looks for `CRM`, `TEAMS`, `MCP`, `CUSTOM_API`, or `OTHER` in the connector type
  selector
- **THEN** none of them appear as a selectable option, consistent with any other unimplemented
  connector type
