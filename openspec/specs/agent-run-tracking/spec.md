# agent-run-tracking Specification

## Purpose

Records every drafting attempt as its own inspectable run — agent, model,
status, token usage, cost, retry count, and structured error — instead of
overwriting a single set of cost fields on the stage or artifact it drafted.

## Requirements

### Requirement: Every drafting attempt-cycle produces exactly one run record
The system SHALL create one run record per drafting attempt-cycle
(the full set of retries for one enqueued drafting job), capturing the
agent and model used, final status, prompt and completion token counts,
cost, the number of attempts made, and a structured error if the final
attempt failed.

#### Scenario: A successful draft is recorded as a run
- **WHEN** a stage is drafted and the AI executor succeeds
- **THEN** a run record exists for that attempt-cycle with a successful status, the model used, token counts, and cost

#### Scenario: An exhausted-retries draft is recorded as a failed run
- **WHEN** a drafting job exhausts its retries without succeeding
- **THEN** a run record exists for that attempt-cycle with a failed status, the number of attempts made, and a structured error describing the final failure

### Requirement: A redraft creates a new run, preserving prior runs
The system SHALL create a new run record for each new drafting
attempt-cycle rather than overwriting a previous one, so every run a
stage or artifact was ever drafted through remains retrievable.

#### Scenario: Redrafting after rejection preserves the earlier run
- **WHEN** a stage is redrafted after an earlier draft's run already exists
- **THEN** the earlier run's record is unchanged and a new run record is created for the redraft

### Requirement: Raw run detail is visible only to write-capable roles
The system SHALL restrict a run's raw detail (structured error, full
token breakdown) to users with write access to the owning client, while
still showing a read-only user the run's status and cost summary.

#### Scenario: A read-only user views run status but not raw detail
- **WHEN** a user without write access to the client views a drafted stage
- **THEN** they can see its cost and completion status but not the underlying run's structured error detail

#### Scenario: A write-capable user views full run detail
- **WHEN** a user with write access to the client views a drafted stage's run
- **THEN** they can see the full run detail including any structured error
