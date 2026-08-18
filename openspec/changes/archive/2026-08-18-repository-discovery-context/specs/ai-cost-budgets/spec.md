## MODIFIED Requirements

### Requirement: AI cost is summable per work item, project, and client
The system SHALL provide the total AI drafting cost incurred, aggregated
per work item, per project, and per client. A client's aggregate SHALL
include the cost of every repository Discovery run for a repository owned
by that client, in addition to stage-drafting and Constitution costs.

#### Scenario: Viewing a project's total AI cost
- **WHEN** a user requests a project's AI cost summary
- **THEN** the total reflects the sum of every drafting run's cost across that project's work items

#### Scenario: A client's total AI cost includes Discovery runs
- **WHEN** a user requests a client's AI cost summary and a Discovery run has completed for one of
  the client's repositories
- **THEN** that run's cost is included in the client's total

### Requirement: A budget threshold blocks further AI spending once exceeded
The system SHALL allow a budget threshold to be configured per
organization, client, or project, and SHALL refuse to enqueue further
AI-drafting work — whether for a project's work item or for a client-owned
repository's Discovery run — once its effective budget scope's accrued
cost meets or exceeds that threshold, until a human explicitly approves
continuing. For a repository-scoped action, which has no project of its
own, the effective scope is the repository's client's threshold if set,
else the organization's — the project tier does not apply.

#### Scenario: Drafting is refused once the budget is exceeded
- **WHEN** a draft is requested for a project whose effective budget scope's accrued cost already meets or exceeds its threshold
- **THEN** the request is refused with an error naming the exceeded budget, and no drafting job is enqueued

#### Scenario: A Discovery run is refused once the client's budget is exceeded
- **WHEN** a Discovery run is requested for a repository whose client has a budget threshold and
  the client's accrued cost already meets or exceeds it
- **THEN** the request is refused with an error naming the exceeded budget, and no Discovery job is
  enqueued

#### Scenario: An explicit approval allows drafting to continue
- **WHEN** a user with the required role explicitly approves continuing past an exceeded budget
- **THEN** further drafting for that scope is allowed again

#### Scenario: An Organization-level budget is the fallback when Client and Project have none
- **WHEN** a draft is requested for a project whose project and client both have no budget threshold configured, and the organization does
- **THEN** the organization's threshold is the effective budget, and drafting is refused once the organization's accrued cost meets or exceeds it

#### Scenario: An Organization-level budget is the fallback for a repository action when its client has none
- **WHEN** a Discovery run is requested for a repository whose client has no budget threshold
  configured, and the organization does
- **THEN** the organization's threshold is the effective budget for that run

### Requirement: A scope without a configured budget is never blocked
The system SHALL impose no spending limit on a project whose own,
client's, and organization's budget thresholds are all unconfigured, nor
on a repository-scoped action whose client's and organization's budget
thresholds are both unconfigured.

#### Scenario: Drafting proceeds normally with no budget set
- **WHEN** a draft is requested for a project whose project, client, and organization all have no configured budget threshold
- **THEN** the request proceeds regardless of accrued cost

#### Scenario: A Discovery run proceeds normally with no budget set
- **WHEN** a Discovery run is requested for a repository whose client and organization both have no
  configured budget threshold
- **THEN** the request proceeds regardless of accrued cost
