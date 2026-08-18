# agent-registry Specification

## Purpose

Lets each pipeline stage type be routed to a specific, named AI agent
configuration instead of every stage using the same single, globally
configured model.

## Requirements

### Requirement: Each stage type routes to a configured agent
The system SHALL determine, from configuration, which agent drafts a
given stage type, defaulting to a single global agent when a stage type
has no specific routing configured.

#### Scenario: A stage type routes to its configured agent
- **WHEN** a stage of a type with a configured agent is drafted
- **THEN** that stage's content is produced using the configured agent

#### Scenario: An unconfigured stage type uses the default agent
- **WHEN** a stage of a type with no specific agent configured is drafted
- **THEN** that stage's content is produced using the default agent

### Requirement: An existing pipeline's agent routing does not change retroactively
The system SHALL determine a stage's agent routing at the time that stage
is drafted using the pipeline's own configuration snapshot, so editing the
agent registry after a pipeline has started does not change how its
already-defined stages are routed.

#### Scenario: Editing agent configuration does not affect an in-flight pipeline
- **WHEN** the agent registry configuration is edited after a pipeline has already started
- **THEN** that pipeline's stages continue to route to the agents configured when the pipeline started
