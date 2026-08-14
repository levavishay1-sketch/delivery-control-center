## MODIFIED Requirements

### Requirement: The drafting mechanism is swappable without changing callers
The system SHALL draft stages through a stable interface, so the mechanism
that produces content (a mock generator, or a real AI model) can be replaced
without changing the pipeline logic that calls it. When a real model
provider is configured, the system SHALL use it; otherwise it SHALL fall
back to the mock generator, without requiring any change to the code that
requests a draft.

#### Scenario: A configured model provider drafts the stage
- **WHEN** a real model provider is configured
- **THEN** stage content is produced by calling that model with the stage's prompt-template instructions and work-item context, and the model, token usage, and cost recorded on the stage reflect the real call

#### Scenario: v1 ships a mock generator behind the interface
- **WHEN** no real model provider is configured
- **THEN** the content is produced by filling the stage's prompt template directly, without calling an external AI model, while still satisfying the same drafting interface a real model would
