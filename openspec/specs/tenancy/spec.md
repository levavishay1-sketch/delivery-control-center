# tenancy Specification

## Purpose
Scopes every project and its data to a specific client under an
organization, so multiple clients' work can coexist in one system without
their data mixing or colliding.

## Requirements

### Requirement: Every project belongs to exactly one client
The system SHALL require every `Project` to belong to a `Client`, and every
`Client` to belong to an `Organization`.

#### Scenario: Creating a project requires a client
- **WHEN** a project is created
- **THEN** it is associated with exactly one client and cannot exist without one

### Requirement: Project key uniqueness is scoped per client
The system SHALL enforce project key uniqueness within a client, not
globally, so two different clients may use the same project key.

#### Scenario: Two clients use the same project key
- **WHEN** Client A and Client B each create a project with key `API`
- **THEN** both succeed, because uniqueness is evaluated within each client independently

#### Scenario: One client reuses a key
- **WHEN** a client already has a project keyed `API` and creates another project keyed `API`
- **THEN** the creation is rejected

### Requirement: An org admin can create a Client
The system SHALL let an org admin create a `Client` under an `Organization`, given a name and a
slug unique within that organization, and SHALL reject the request for any user who is not an org
admin.

#### Scenario: Org admin creates a client
- **WHEN** an org admin submits a name and slug for a new client
- **THEN** a `Client` record is created under their organization and appears in the Clients hub

#### Scenario: Non-admin attempts to create a client
- **WHEN** a user who is not an org admin attempts to create a client
- **THEN** the request is rejected and no `Client` record is created

#### Scenario: Duplicate slug within an organization
- **WHEN** an org admin submits a slug already used by another client in the same organization
- **THEN** the request is rejected, consistent with the existing organization-scoped slug
  uniqueness constraint

### Requirement: An org admin can edit a Client's name and slug
The system SHALL let an org admin update an existing `Client`'s name and slug, and SHALL reject
the request for any user who is not an org admin.

#### Scenario: Org admin edits a client
- **WHEN** an org admin submits a new name and/or slug for an existing client
- **THEN** the client's record is updated and the change is reflected everywhere the client's
  name is shown

### Requirement: An org admin can deactivate a Client
The system SHALL let an org admin deactivate a `Client` without deleting its historical data
(projects, work items, audit trail, cost records), and SHALL reject the request for any user who
is not an org admin. A deactivated client's active projects, connectors, and repositories remain
visible for historical/audit purposes but SHALL be excluded from active-work surfaces (Dashboard,
Attention Center) going forward.

#### Scenario: Org admin deactivates a client
- **WHEN** an org admin deactivates a client
- **THEN** the client is marked inactive, its historical data is preserved and remains viewable
  from the Clients hub, and it no longer appears in active-work surfaces

#### Scenario: Non-admin attempts to deactivate a client
- **WHEN** a user who is not an org admin attempts to deactivate a client
- **THEN** the request is rejected and the client's active state is unchanged

#### Scenario: A deactivated client's data is not deleted
- **WHEN** a client is deactivated
- **THEN** none of its projects, work items, audit events, or cost records are deleted or altered
  beyond the client's own active flag

### Requirement: An org admin can reactivate a deactivated Client
The system SHALL let an org admin reactivate a previously deactivated `Client`, restoring its
visibility on active-work surfaces (Dashboard, Attention Center), and SHALL reject the request for
any user who is not an org admin.

#### Scenario: Org admin reactivates a client
- **WHEN** an org admin reactivates a previously deactivated client
- **THEN** the client is marked active again and its projects reappear on the Dashboard and
  Attention Center

#### Scenario: Non-admin attempts to reactivate a client
- **WHEN** a user who is not an org admin attempts to reactivate a client
- **THEN** the request is rejected and the client's inactive state is unchanged
