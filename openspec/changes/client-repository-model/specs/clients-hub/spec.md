## Purpose

Gives a manager one place to see and manage everything scoped to a client — its projects, its
repositories, and its connectors together — rather than only inline sections on the Dashboard,
and to create, edit, or deactivate a client without reaching into the database directly.

## ADDED Requirements

### Requirement: A Clients hub lists every client the user can access
The system SHALL provide a Clients hub page listing every client the current user has access to
(all clients for an org admin; only clients they hold a membership on otherwise), showing each
client's name, project count, and active/inactive state, reachable from the primary navigation.

#### Scenario: Org admin views the Clients hub
- **WHEN** an org admin opens the Clients hub
- **THEN** every client in the organization is listed, each showing its name, project count, and
  active state

#### Scenario: Client-scoped user views the Clients hub
- **WHEN** a user with membership on only some clients opens the Clients hub
- **THEN** only the clients they hold a membership on are listed

### Requirement: A client detail view shows its projects, repositories, and connectors together
The system SHALL provide a client detail view showing, in one place: the client's projects, every
repository owned by the client (across all of its projects, not only one), and the client's
connectors — reachable by selecting a client from the Clients hub.

#### Scenario: Viewing a client's full picture
- **WHEN** a user with access to a client opens its detail view
- **THEN** they see its projects, its repositories (regardless of which project originally linked
  each one), and its connectors, without navigating to each project individually

### Requirement: A deactivated client is visually distinguished and excluded from active-work surfaces
The system SHALL show a deactivated client's inactive state clearly in the Clients hub and its
detail view, and SHALL exclude a deactivated client's projects from the Dashboard and Attention
Center while keeping them reachable from the client's own detail view for historical reference.

#### Scenario: A deactivated client in the hub
- **WHEN** a client has been deactivated
- **THEN** the Clients hub shows its inactive state, and its projects no longer appear on the
  Dashboard or Attention Center

#### Scenario: A deactivated client's history remains reachable
- **WHEN** a user opens a deactivated client's detail view
- **THEN** its projects, repositories, and connectors are still visible for historical reference
