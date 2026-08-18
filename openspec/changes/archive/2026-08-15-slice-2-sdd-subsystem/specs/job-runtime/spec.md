## Purpose

Makes long-running AI drafting durable and crash-recoverable by moving it
onto a persisted, retried job instead of blocking an HTTP request and
leaving nothing behind on failure.

## ADDED Requirements

### Requirement: Drafting a stage enqueues a durable job instead of blocking the request
The system SHALL enqueue a job to perform stage drafting rather than
calling the AI executor synchronously within the triggering request, so
the request can return before drafting completes.

#### Scenario: Requesting a draft returns before drafting finishes
- **WHEN** a user requests a stage be drafted
- **THEN** the request completes and a job is queued to perform the draft, without waiting for the AI executor to finish

### Requirement: A failed job is retried with exponential backoff up to a maximum
The system SHALL retry a job that fails with an increasing delay between
attempts, up to a configured maximum attempt count.

#### Scenario: A transient failure is retried
- **WHEN** a job's execution throws an error and it has not yet reached its maximum attempt count
- **THEN** the job is rescheduled for a later attempt rather than abandoned immediately

### Requirement: A job that exhausts its retries leaves the stage in an observable failed state
The system SHALL, when a job reaches its maximum attempt count without
succeeding, move the associated stage out of its in-progress state into a
state a human can see and act on — never leave it indefinitely appearing
"in progress."

#### Scenario: All retries are exhausted
- **WHEN** a drafting job fails on its final allowed attempt
- **THEN** the stage's status no longer shows it as actively drafting, and the failure is visible to a user

### Requirement: A job can only be claimed by one worker at a time
The system SHALL claim a queued job atomically, so two concurrent workers
cannot both process the same job.

#### Scenario: Two workers poll simultaneously
- **WHEN** two worker processes attempt to claim jobs at the same moment and only one queued job is available
- **THEN** exactly one worker claims it; the other finds nothing to claim
