# clients-hub Specification

## Purpose

Gives a manager one place to see and manage everything scoped to a client — its projects, its
repositories, and its connectors together — rather than only inline sections on the Dashboard,
and to create, edit, or deactivate a client without reaching into the database directly.

## Requirements

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

### Requirement: A client detail view shows its top-level, open work items
The system SHALL provide, in the client detail view, a "Tasks" section listing every `WorkItem`
across the client's projects with no parent (top-level) and an open status (not `COMPLETED` or
`CLOSED`), spanning every work-item type, and SHALL NOT list a WorkItem that has a parent even
when its top-level ancestor is shown in the same section.

#### Scenario: A top-level open work item appears
- **WHEN** a client has a `WorkItem` with no parent and a status other than `COMPLETED`/`CLOSED`
- **THEN** it appears in the client detail view's Tasks section

#### Scenario: A child work item does not appear even when its parent does
- **WHEN** a client has a `WorkItem` with a parent, and that parent itself has no parent (i.e. the
  parent is top-level and appears in the Tasks section)
- **THEN** the child WorkItem does not get its own row in the Tasks section

#### Scenario: Every work-item type is included, not only Tasks
- **WHEN** a client's top-level open work spans multiple work-item types (e.g. a `PROJECT`-typed
  WorkItem, a `TASK`, and a `BUG`, each with no parent)
- **THEN** all of them appear in the Tasks section, not only items of type `TASK`

#### Scenario: A completed or closed top-level work item is excluded
- **WHEN** a client has a top-level `WorkItem` whose status is `COMPLETED` or `CLOSED`
- **THEN** it does not appear in the Tasks section

#### Scenario: The Tasks section is distinct from the existing Projects panel
- **WHEN** a user views a client's detail page
- **THEN** the Tasks section (top-level WorkItems of any type) and the existing Projects panel
  (the client's `Project` model entities) are shown as separate sections, and neither list is
  derived from or replaces the other
