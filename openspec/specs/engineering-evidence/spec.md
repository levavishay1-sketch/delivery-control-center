# engineering-evidence Specification

## Purpose

Traces a work item to the real code that implements it — repositories,
commits, pull requests, test runs, builds, and deployments — populated
from GitHub via webhook and the existing connector adapter, and links a
work item to its evidence explicitly rather than by inference.

## Requirements

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

### Requirement: Commits, pull requests, test runs, builds, and deployments are recorded from GitHub
The system SHALL record a `Commit` for each commit, a `PullRequest` for
each pull request (with its current state and CI status), a `TestRun` for
each test execution, a `Build` for each build, and a `Deployment` for each
deployment reported by GitHub for a linked `Repository` — via webhook
events and, for catching up on history that predates the link, the
existing GitHub adapter.

#### Scenario: A webhook event records new evidence
- **WHEN** GitHub sends a push, pull_request, check_run, or deployment_status webhook event for a linked repository
- **THEN** the corresponding `Commit`/`PullRequest`/`TestRun`/`Build`/`Deployment` record is created or updated to match

#### Scenario: Linking a repository with existing history
- **WHEN** a repository with pre-existing commits and pull requests is linked
- **THEN** its existing history is fetched and recorded, not just events from the moment of linking forward

### Requirement: A work item is linked to its evidence explicitly, not inferred
The system SHALL let a write-capable user explicitly link a `PullRequest`
to a work item as its `Evidence`, and SHALL NOT infer this link from a PR
title, branch name, or any other naming convention.

#### Scenario: Manually linking a pull request to a work item
- **WHEN** a write-capable user links a pull request to a work item
- **THEN** an `Evidence` record connects them, visible on the work item's Code & Changes tab

#### Scenario: Unlinking evidence
- **WHEN** a write-capable user removes a previously-linked pull request from a work item
- **THEN** the `Evidence` record is removed and the work item's evidence state reflects the change

### Requirement: The 360° Record traces work item to code change
The system SHALL show, on a work item's 360° Record, a Code & Changes tab
listing its linked pull requests and their commits with current CI status,
and a Tests tab listing test runs associated with those pull requests.

#### Scenario: Viewing linked evidence
- **WHEN** a user with read access to a work item views its Code & Changes tab
- **THEN** they see every linked pull request, its commits, and its current CI/check status

#### Scenario: A work item with no linked evidence yet
- **WHEN** a user views the Code & Changes tab of a work item with no linked pull requests
- **THEN** the tab shows an empty state, not an error, and (for a write-capable role) the action to link one
