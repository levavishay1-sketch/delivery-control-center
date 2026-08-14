# sdd-pipeline Specification

## Purpose
Runs each work item through a configurable sequence of drafting and
human-approval stages, so nothing advances toward delivery without passing
through the checkpoints the organization has defined.

## Requirements

### Requirement: Pipeline stage sequence is configuration-driven
The system SHALL determine the sequence of pipeline stages, and which
stages require human approval, from configuration rather than from
hardcoded application logic.

#### Scenario: New pipeline starts at the first configured stage
- **WHEN** a pipeline is created for a work item
- **THEN** the pipeline's current stage is the first stage defined in the configuration, seeded with that stage in a pending state

#### Scenario: Approval advances to the next configured stage
- **WHEN** a stage's gate is approved and the configuration defines a stage after it
- **THEN** the pipeline's current stage becomes that next configured stage

### Requirement: A stage must be drafted before it can be approved
A stage SHALL be filled with drafted content and moved to a pending-approval
state before a human approval or rejection decision can be recorded against
it.

#### Scenario: Drafting a pending stage
- **WHEN** a stage that is in a not-yet-drafted or previously-rejected state is drafted
- **THEN** the stage is filled with content and its status becomes pending approval

#### Scenario: Approval is refused for a stage that is not pending approval
- **WHEN** an approval or rejection is submitted for a stage that is not currently pending approval
- **THEN** the system refuses the request and the stage's state does not change

### Requirement: Approving the final stage completes the pipeline
The system SHALL mark the pipeline completed when the last configured
stage's gate is approved, and SHALL NOT create a further stage.

#### Scenario: Approving the last configured stage
- **WHEN** the gate for the last stage defined in the configuration is approved
- **THEN** the pipeline's status becomes completed and no further stage is created

### Requirement: Rejecting a stage blocks the pipeline until it is redrafted
The system SHALL block the pipeline from advancing when a stage's gate is
rejected, and SHALL only unblock it once that stage is drafted again.

#### Scenario: Rejecting a pending-approval stage
- **WHEN** a human rejects a stage that is pending approval
- **THEN** the stage's status becomes rejected and the pipeline's status becomes blocked

#### Scenario: Redrafting a rejected stage unblocks the pipeline
- **WHEN** a rejected stage is drafted again
- **THEN** the stage returns to pending approval and the pipeline's status returns to active
