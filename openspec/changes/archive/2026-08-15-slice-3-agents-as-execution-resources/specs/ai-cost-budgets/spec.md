## Purpose

Gives a client or project a configurable AI spending limit and stops
further drafting, rather than letting cost accrue unbounded, once that
limit is reached.

## ADDED Requirements

### Requirement: AI cost is summable per work item, project, and client
The system SHALL provide the total AI drafting cost incurred, aggregated
per work item, per project, and per client.

#### Scenario: Viewing a project's total AI cost
- **WHEN** a user requests a project's AI cost summary
- **THEN** the total reflects the sum of every drafting run's cost across that project's work items

### Requirement: A budget threshold blocks further drafting once exceeded
The system SHALL allow a budget threshold to be configured per client or
project, and SHALL refuse to enqueue further drafting for that scope once
its accrued cost meets or exceeds the threshold, until a human explicitly
approves continuing.

#### Scenario: Drafting is refused once the budget is exceeded
- **WHEN** a draft is requested for a scope whose accrued cost already meets or exceeds its configured budget
- **THEN** the request is refused with an error naming the exceeded budget, and no drafting job is enqueued

#### Scenario: An explicit approval allows drafting to continue
- **WHEN** a user with the required role explicitly approves continuing past an exceeded budget
- **THEN** further drafting for that scope is allowed again

### Requirement: A scope without a configured budget is never blocked
The system SHALL impose no spending limit on a client or project that has
no budget threshold configured.

#### Scenario: Drafting proceeds normally with no budget set
- **WHEN** a draft is requested for a scope with no configured budget threshold
- **THEN** the request proceeds regardless of accrued cost
