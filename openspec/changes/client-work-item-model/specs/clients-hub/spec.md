## RENAMED Requirements

- FROM: `### Requirement: A client detail view shows its projects, repositories, and connectors together`
- TO: `### Requirement: A client detail view shows its Work Items, Repositories, and Connections together`

## MODIFIED Requirements

### Requirement: A client detail view shows its Work Items, Repositories, and Connections together

The system SHALL provide a client detail view whose header shows the client's name and its
existing `slug` as its identifier, and exactly three sections: WORK ITEMS (every top-level Work
Item across the client's projects, of any type and any status, each linking to its Work Item
detail screen, with an "Add Work Item" action opening a dedicated creation screen), REPOSITORIES
(every Repository owned by the client, each linking to its Repository detail screen, with an "Add
Repository" action opening a dedicated creation screen), and CONNECTIONS (every Connection owned
by the client, each linking to its Connection detail screen, with an "Add Connection" action
opening a dedicated creation screen). The view SHALL NOT show a separate Requirements section, a
separate Projects list panel, or the client's Connectors — reachable by selecting a client from
the Clients hub.

#### Scenario: Viewing a client's full picture
- **WHEN** a user with access to a client opens its detail view
- **THEN** they see the client's name and slug, its top-level Work Items of every type and status,
  its Repositories, and its Connections, with no separate Requirements or Projects panel

#### Scenario: Work Items of every status appear, not only open ones
- **WHEN** a client has top-level Work Items in `DRAFT`, `OPEN`, `COMPLETED`, and `CLOSED` status
- **THEN** all of them appear in the WORK ITEMS section, unfiltered by status

#### Scenario: A child Work Item does not appear even when its parent does
- **WHEN** a client has a Work Item with a parent, and that parent itself has no parent
- **THEN** only the parent appears in the WORK ITEMS section; the child does not get its own row

#### Scenario: Add actions open dedicated screens, not inline forms
- **WHEN** a write-capable user selects "Add Work Item," "Add Repository," or "Add Connection"
- **THEN** they are taken to that action's own dedicated creation screen, not an inline form on the
  Client page

### Requirement: A deactivated client is visually distinguished and excluded from active-work surfaces

The system SHALL show a deactivated client's inactive state clearly in the Clients hub and its
detail view, and SHALL exclude a deactivated client's projects from the Dashboard and Attention
Center while keeping its Work Items, Repositories, and Connections reachable from the client's own
detail view for historical reference.

#### Scenario: A deactivated client in the hub
- **WHEN** a client has been deactivated
- **THEN** the Clients hub shows its inactive state, and its projects no longer appear on the
  Dashboard or Attention Center

#### Scenario: A deactivated client's history remains reachable
- **WHEN** a user opens a deactivated client's detail view
- **THEN** its Work Items, Repositories, and Connections are still visible for historical reference

## REMOVED Requirements

### Requirement: A client detail view shows its top-level, open work items

Superseded by this change's "A client detail view shows its Work Items, Repositories, and
Connections together," which shows top-level Work Items of every status (not only open ones)
under the WORK ITEMS section.
