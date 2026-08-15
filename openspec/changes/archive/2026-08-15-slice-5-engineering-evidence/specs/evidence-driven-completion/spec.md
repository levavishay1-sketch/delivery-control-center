## Purpose

Ensures a work item's `COMPLETED` status is backed by real evidence — a
merged pull request with passing tests — rather than a human's unverified
claim, with an explicit, audited exception path for the cases where that
isn't possible.

## ADDED Requirements

### Requirement: Completing a work item requires qualifying evidence
The system SHALL refuse to transition a work item from `APPROVED` to
`COMPLETED` unless it has at least one linked `PullRequest` that is merged
and whose latest associated `TestRun` passed, or an approved
`CompletionException` exists for it instead.

#### Scenario: Completing with qualifying evidence
- **WHEN** a work item with a merged, passing-tests linked pull request is moved from `APPROVED` to `COMPLETED`
- **THEN** the transition succeeds

#### Scenario: Completing without qualifying evidence is refused
- **WHEN** a work item with no linked pull request, or one that isn't merged, or whose tests didn't pass, is moved from `APPROVED` to `COMPLETED`
- **THEN** the transition is rejected with an error naming what evidence is missing, and the status is unchanged

### Requirement: A write-capable role can approve a completion exception
The system SHALL let a write-capable role record an approved
`CompletionException` for a work item, with a required reason, allowing it
to complete without qualifying evidence.

#### Scenario: Approving an exception
- **WHEN** a write-capable user approves a completion exception for a work item, giving a reason
- **THEN** a `CompletionException` record is created, and the work item can now move to `COMPLETED` without qualifying evidence

#### Scenario: An exception is recorded in the audit trail
- **WHEN** a completion exception is approved
- **THEN** an audit event records who approved it, when, and the stated reason

### Requirement: The Evidence tab explains the work item's completion state
The system SHALL show, on a work item's 360° Record Evidence tab, whether
its completion policy is currently satisfied and — if not — exactly what
is missing (no linked PR / PR not merged / tests not passing), or that an
exception is in place.

#### Scenario: Viewing an unsatisfied completion policy
- **WHEN** a user views the Evidence tab of a work item that doesn't yet qualify for completion
- **THEN** they see exactly what's missing, in plain language, not just a pass/fail indicator
