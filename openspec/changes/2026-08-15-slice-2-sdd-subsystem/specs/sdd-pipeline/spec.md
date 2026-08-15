## MODIFIED Requirements

### Requirement: Pipeline stage sequence is configuration-driven
The system SHALL determine the sequence of pipeline stages, and which
stages require human approval, from configuration at the moment a
pipeline is started, and SHALL fix that sequence onto the pipeline for
its entire lifetime — a later change to the configuration SHALL NOT alter
the stage sequence or approval requirements of a pipeline that already
exists.

#### Scenario: New pipeline starts at the first configured stage
- **WHEN** a pipeline is started for a work item
- **THEN** the pipeline's current stage is the first stage defined in the configuration at that moment, seeded with that stage in a pending state

#### Scenario: Approval advances to the next configured stage
- **WHEN** a stage's gate is approved and the pipeline's own stage sequence defines a stage after it
- **THEN** the pipeline's current stage becomes that next stage

#### Scenario: A stage configured without a required approval completes automatically
- **WHEN** a stage is drafted and its configuration marks human approval as not required
- **THEN** the stage completes without waiting for a human decision, and the pipeline advances as if it had been approved

#### Scenario: Editing configuration does not affect an in-flight pipeline
- **WHEN** `config/workflow.yaml`'s stage sequence is edited after a pipeline has already started
- **THEN** that pipeline continues to use the stage sequence it started with, unaffected by the edit

## ADDED Requirements

### Requirement: Drafting a stage does not block the request that triggers it
The system SHALL return from a draft request before the AI executor call
completes, performing the actual drafting asynchronously.

#### Scenario: A draft request returns promptly
- **WHEN** a user requests a stage be drafted
- **THEN** the request completes without waiting for the AI executor's response

### Requirement: A redraft's context includes the prior rejection comment and any clarification answers
The system SHALL include, when a rejected stage is drafted again, the
comment recorded on its rejection and the answers to any clarification
questions given during the run, in what is provided to the AI executor —
never repeating an identical prompt with no memory of why the prior
attempt was rejected.

#### Scenario: A redraft reflects the rejection comment
- **WHEN** a stage is rejected with a comment and then drafted again
- **THEN** the AI executor receives that comment as part of what it is drafting against

### Requirement: Stage content is versioned on every draft
The system SHALL preserve a rejected or superseded draft's content rather
than discarding it when a stage is drafted again, so every version a
stage ever held remains retrievable.

#### Scenario: A redraft preserves the prior version
- **WHEN** a stage that was previously drafted and rejected is drafted again
- **THEN** the prior draft's content remains retrievable as an earlier version, distinct from the new content
