## MODIFIED Requirements

### Requirement: A project can link a GitHub repository as a source of evidence
The system SHALL let a write-capable user link a GitHub repository to a project through that
project's `Connector`. If no `Repository` already exists for that client matching the fetched
repository, the system SHALL create one, owned by the project's client. If a `Repository` already
exists for that client (linked to it from another project), the system SHALL reuse it rather than
creating a duplicate. Either way, the system SHALL record the link between the project and the
repository, and SHALL begin accepting webhook events and fetching data for it.

#### Scenario: Linking a repository
- **WHEN** a write-capable user links a GitHub repository to a project with a configured GitHub
  connector, and no repository under that client matches it yet
- **THEN** a `Repository` record is created, owned by the project's client, linked to the
  requesting project, and the system begins accepting webhook events and fetching data for it

#### Scenario: Linking a repository already known to the client
- **WHEN** a write-capable user links a GitHub repository to a project, and a `Repository` record
  for that same repository already exists under the project's client (because another project
  under the same client linked it first)
- **THEN** the existing `Repository` record is reused — not duplicated — and linked to the
  requesting project as well, so both projects share the same underlying evidence history
