# task-decomposition Specification

## Purpose

Turns a TASKS stage's AI-drafted task list into real, individually-assignable child WorkItems,
behind an explicit human selection step distinct from the stage's own approval gate.

## Requirements

### Requirement: A TASKS stage draft produces structured, evidence-free task drafts alongside its prose
The system SHALL, when drafting a TASKS stage, produce a structured list of task drafts (title and
optional description) validated against a defined schema, in addition to the stage's existing
prose content. A draft that fails validation SHALL be treated as a failed drafting attempt, not
partially or silently accepted. Re-drafting a TASKS stage SHALL replace its prior task drafts, not
accumulate alongside them.

#### Scenario: A well-formed TASKS draft produces task drafts
- **WHEN** a TASKS stage's AI output matches the expected task-drafts schema
- **THEN** its task drafts are stored, each associated with that stage

#### Scenario: A malformed TASKS response fails the draft
- **WHEN** a TASKS stage's AI output does not match the expected task-drafts schema
- **THEN** the draft attempt fails and no task drafts are stored from it

#### Scenario: Redrafting replaces prior task drafts
- **WHEN** a TASKS stage that already has task drafts from a prior attempt is redrafted
  successfully
- **THEN** the new attempt's task drafts replace the prior ones, which are no longer present

### Requirement: A write-capable user can materialize approved task drafts into real WorkItems
The system SHALL allow a write-capable user to select one or more un-materialized task drafts from
a TASKS stage that has been approved (reached its `DONE` status through the stage's own approval
gate) and create a real child WorkItem for each selected draft, under the pipeline's own WorkItem.
The system SHALL NOT allow materializing task drafts from a TASKS stage that has not yet been
approved. The system SHALL NOT allow the same task draft to be materialized more than once.

#### Scenario: Materializing selected drafts from an approved TASKS stage
- **WHEN** a write-capable user selects a subset of un-materialized task drafts from an approved
  TASKS stage and materializes them
- **THEN** a real child WorkItem is created for each selected draft, linked under the pipeline's
  WorkItem, and each selected draft is marked materialized

#### Scenario: Materializing from a not-yet-approved TASKS stage is refused
- **WHEN** a write-capable user attempts to materialize task drafts from a TASKS stage that has
  not reached its approved (`DONE`) status
- **THEN** the request is refused and no WorkItem is created

#### Scenario: Re-materializing an already-materialized draft is refused
- **WHEN** a write-capable user attempts to materialize a task draft that has already been
  materialized
- **THEN** the request is refused for that draft and no second WorkItem is created for it

#### Scenario: A read-only user cannot materialize task drafts
- **WHEN** a user without write access to the pipeline's client attempts to materialize task
  drafts
- **THEN** the request is refused
