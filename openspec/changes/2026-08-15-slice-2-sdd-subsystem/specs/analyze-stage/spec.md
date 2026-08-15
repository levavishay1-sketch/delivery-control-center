## Purpose

Checks a work item's own Constitution/SPEC/Plan/Tasks artifacts for
consistency before implementation begins, surfacing severity-rated
findings instead of silently trusting them to agree with each other.

## ADDED Requirements

### Requirement: Analyze produces severity-rated findings across prior artifacts
The system SHALL, when the Analyze stage is drafted, produce zero or more
findings, each with a severity of Info, Warning, Medium, High, or
Critical, identifying which prior artifact a finding relates to.

#### Scenario: An inconsistency is found
- **WHEN** the Analyze stage is drafted and the AI executor detects the Plan contradicts the SPEC
- **THEN** a finding is recorded naming the Plan as the related artifact, with a severity

### Requirement: A Critical finding blocks advancing past Analyze
The system SHALL refuse to advance a pipeline from the Analyze stage to
the next stage while any finding attached to the current Analyze run has
Critical severity.

#### Scenario: Approving Analyze with a Critical finding present
- **WHEN** an Analyze stage's gate is approved while a Critical-severity finding from that run is still unresolved
- **THEN** the pipeline does not advance past Analyze

#### Scenario: No Critical findings allows advancement
- **WHEN** an Analyze stage's gate is approved and its findings are all below Critical severity
- **THEN** the pipeline advances to the next stage normally

### Requirement: Clearing a Critical finding requires redrafting the flagged stage
The system SHALL clear a Critical finding only when the prior stage it
relates to is redrafted, followed by a new Analyze run — not by any
direct dismissal of the finding itself.

#### Scenario: Redrafting the flagged stage requires a fresh Analyze run
- **WHEN** the stage a Critical finding relates to is redrafted
- **THEN** the Analyze stage must be drafted again before the pipeline can advance past it
