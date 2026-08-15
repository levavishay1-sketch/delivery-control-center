# ai-drafting Specification

## Purpose
Drafts each pipeline stage's content automatically from the project's
configured prompt templates, standing in for a human author until a human
reviews it at that stage's approval gate.

## Requirements

### Requirement: Stage content is generated from configured prompt templates
The system SHALL generate a stage's draft content from the prompt template
configured for that stage type, filled in with the work item's details and,
where applicable, the content of the preceding completed stage.

#### Scenario: Drafting a stage uses the configured template
- **WHEN** a stage is drafted
- **THEN** its content is produced from that stage type's configured prompt template rather than from a fixed, uneditable string in application code

### Requirement: Every draft records its model, token usage, and cost
The system SHALL record, for every drafting attempt, which agent and
model produced it, the prompt and completion token counts, and the
resulting cost, on a run record the drafted stage or artifact references
— not as fields overwritten directly on the stage or artifact itself.

#### Scenario: Drafting a stage records cost attribution
- **WHEN** a stage is drafted
- **THEN** a run record captures which agent and model produced it, the prompt and completion token counts, and the resulting cost, and the stage references that run

### Requirement: The drafting mechanism is swappable without changing callers
The system SHALL draft stages through a stable interface, so the
mechanism that produces content (a mock generator, or a real AI model)
can be replaced without changing the pipeline logic that calls it, and so
different stage types can be routed to different configured agents
without changing that calling logic either. When a real model provider is
configured for a stage's routed agent, the system SHALL use it;
otherwise it SHALL fall back to the mock generator, without requiring any
change to the code that requests a draft.

#### Scenario: A configured model provider drafts the stage
- **WHEN** a stage's routed agent has a real model provider configured
- **THEN** stage content is produced by calling that model with the stage's prompt-template instructions and work-item context, and the run record reflects the real call

#### Scenario: v1 ships a mock generator behind the interface
- **WHEN** a stage's routed agent has no real model provider configured
- **THEN** the content is produced by filling the stage's prompt template directly, without calling an external AI model, while still satisfying the same drafting interface a real model would
