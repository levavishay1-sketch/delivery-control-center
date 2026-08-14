## Purpose

Scopes every project and its data to a specific client under an
organization, so multiple clients' work can coexist in one system without
their data mixing or colliding.

## ADDED Requirements

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
