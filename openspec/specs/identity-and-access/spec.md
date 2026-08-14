# identity-and-access Specification

## Purpose
Establishes real user identity and backend authorization, so actions in the
system are attributable to a verified person and scoped to the clients they
are permitted to act on.

## Requirements

### Requirement: Every mutation requires an authenticated session
The system SHALL reject any request to a mutating route or domain command
that does not carry a valid, authenticated session.

#### Scenario: Unauthenticated mutation is rejected
- **WHEN** a request with no valid session attempts to create, sync, draft, approve, or reject anything
- **THEN** the request is rejected before any state changes

### Requirement: Authorization is scoped per client via role
The system SHALL grant a user access to act on a client's data only if they
have a `ClientMembership` for that client with a role permitted for the
attempted action, or are an organization admin.

#### Scenario: A user without membership on a client is rejected
- **WHEN** an authenticated user with no membership on Client B attempts to act on Client B's data
- **THEN** the request is rejected

#### Scenario: A Viewer cannot approve a gate
- **WHEN** a user whose only role on a client is Viewer attempts to approve a stage
- **THEN** the request is rejected

### Requirement: Recorded identity comes from the session, not client input
The system SHALL derive the acting user's identity from their authenticated
session for any decision or audit record, never from a client-supplied
field.

#### Scenario: Approving a stage records the real logged-in user
- **WHEN** an authenticated user approves a stage
- **THEN** the resulting `Approval` and `AuditEvent` reference that user's real account, not a name supplied in the request body
