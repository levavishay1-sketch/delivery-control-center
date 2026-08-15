## MODIFIED Requirements

### Requirement: A budget threshold blocks further drafting once exceeded
The system SHALL allow a budget threshold to be configured per
organization, client, or project, and SHALL refuse to enqueue further
drafting for a project once its effective budget's scope (the project's
own threshold if set, else its client's, else its organization's) has
accrued cost meeting or exceeding that threshold, until a human
explicitly approves continuing.

#### Scenario: Drafting is refused once the budget is exceeded
- **WHEN** a draft is requested for a project whose effective budget scope's accrued cost already meets or exceeds its threshold
- **THEN** the request is refused with an error naming the exceeded budget, and no drafting job is enqueued

#### Scenario: An explicit approval allows drafting to continue
- **WHEN** a user with the required role explicitly approves continuing past an exceeded budget
- **THEN** further drafting for that scope is allowed again

#### Scenario: An Organization-level budget is the fallback when Client and Project have none
- **WHEN** a draft is requested for a project whose project and client both have no budget threshold configured, and the organization does
- **THEN** the organization's threshold is the effective budget, and drafting is refused once the organization's accrued cost meets or exceeds it

### Requirement: A scope without a configured budget is never blocked
The system SHALL impose no spending limit on a project whose own,
client's, and organization's budget thresholds are all unconfigured.

#### Scenario: Drafting proceeds normally with no budget set
- **WHEN** a draft is requested for a project whose project, client, and organization all have no configured budget threshold
- **THEN** the request proceeds regardless of accrued cost
