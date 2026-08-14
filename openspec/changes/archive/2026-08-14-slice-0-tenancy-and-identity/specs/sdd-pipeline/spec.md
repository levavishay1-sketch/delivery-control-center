## MODIFIED Requirements

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

#### Scenario: A stage configured without a required approval completes automatically
- **WHEN** a stage is drafted and its configuration marks human approval as not required
- **THEN** the stage completes without waiting for a human decision, and the pipeline advances as if it had been approved

### Requirement: A stage must be drafted before it can be approved
A stage SHALL be filled with drafted content and moved to a pending-approval
state before a human approval or rejection decision can be recorded against
it. While a draft is being generated, the stage SHALL be in an observable
drafting state, not a state indistinguishable from "not yet started."

#### Scenario: Drafting a pending stage
- **WHEN** a stage that is in a not-yet-drafted or previously-rejected state is drafted
- **THEN** the stage is filled with content and its status becomes pending approval

#### Scenario: A stage is observably drafting while content is generated
- **WHEN** drafting begins for a stage
- **THEN** the stage's status becomes drafting before content is available, and becomes pending approval once the draft completes

#### Scenario: Approval is refused for a stage that is not pending approval
- **WHEN** an approval or rejection is submitted for a stage that is not currently pending approval
- **THEN** the system refuses the request and the stage's state does not change
