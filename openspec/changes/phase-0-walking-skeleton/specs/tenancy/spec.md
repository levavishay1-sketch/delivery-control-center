# tenancy

## ADDED Requirements

### Requirement: Client wall via RLS backstop

Every tenant-scoped table SHALL carry a `client_id` column and a
Postgres RLS policy keyed on `current_setting('app.current_client')`.
The application SHALL connect as a role that is neither a superuser nor
`BYPASSRLS`, so an application-layer bug cannot cross the wall.

#### Scenario: app role cannot bypass RLS

- **WHEN** the application connects
- **THEN** it connects as `dcc_app`, which has `NOSUPERUSER NOBYPASSRLS`

#### Scenario: tenant context is transaction-local

- **WHEN** `withTenant(clientId, fn)` runs
- **THEN** `app.current_client` is set with `SET LOCAL` inside a
  transaction and cannot leak to another pooled connection checkout

### Requirement: Project hierarchy

The model SHALL be `client → project → workitem → task`. A `workitem`
SHALL reference a `project`, and SHALL also carry `client_id` directly
(denormalised) so RLS and future partitioning key on it without a join.

### Requirement: Org-shared repositories

A `repo` MAY have a null `client_id`, meaning org-shared (shared
libraries, infrastructure). Work and events SHALL always be scoped by
`workitem.client_id`, never by `repo.client_id`, so a shared repo is not
a tenancy hole.

#### Scenario: shared repo used by two clients

- **WHEN** WorkItems for client A and client B both touch a repo with
  `client_id = null`
- **THEN** neither client's events or WorkItems are visible to the other

### Requirement: Explicit, audited repo linking

Linking a repo to a client or project SHALL be a manual action recording
`added_by` and `added_at`. The system SHALL NOT infer or auto-create
these links.
