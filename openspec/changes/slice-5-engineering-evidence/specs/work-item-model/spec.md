## MODIFIED Requirements

### Requirement: Status changes go through a dedicated, validated command
The system SHALL expose status changes only through `updateWorkItemStatus`,
never through the general `updateWorkItem` field-update command, and SHALL
validate every transition against a fixed state machine. The
`APPROVED` → `COMPLETED` transition additionally requires qualifying
engineering evidence — at least one linked, merged `PullRequest` whose
latest `TestRun` passed — or an approved `CompletionException` for the
work item; the request is rejected with an error naming what evidence is
missing if neither is present.

#### Scenario: A valid transition succeeds
- **WHEN** a work item in `OPEN` status is moved to `IN_PROGRESS`
- **THEN** the transition succeeds and an audit event records the old and new status

#### Scenario: An invalid transition is rejected
- **WHEN** a work item in `OPEN` status is moved directly to `COMPLETED`
- **THEN** the request is rejected with a validation error and the status is unchanged

#### Scenario: A terminal status cannot be reopened
- **WHEN** a work item in `COMPLETED` status is moved to any other status
- **THEN** the request is rejected

#### Scenario: Completing without qualifying evidence is rejected by the status command
- **WHEN** `updateWorkItemStatus` is called moving a work item from `APPROVED` to `COMPLETED`, and it has no qualifying evidence and no approved `CompletionException`
- **THEN** the request is rejected with an error naming what evidence is missing, and the status is unchanged
