# pipeline-optional-start Specification

## Purpose

Makes starting the SDD documentation pipeline an explicit user action
instead of an automatic side effect of creating a work item, since not
every work item needs to go through it.

## Requirements

### Requirement: A work item exists without a pipeline until one is explicitly started
The system SHALL create a work item with no associated pipeline, and
SHALL only create a pipeline for it when a user explicitly requests one.

#### Scenario: Creating a work item does not create a pipeline
- **WHEN** a work item is created
- **THEN** no pipeline exists for it until a separate "start pipeline" request is made

#### Scenario: Explicitly starting a pipeline
- **WHEN** a user requests a pipeline be started for a work item that has none
- **THEN** a pipeline is created for that work item

### Requirement: A work item can have at most one pipeline, ever
The system SHALL refuse to start a second pipeline for a work item that
already has one, regardless of that pipeline's status.

#### Scenario: Starting a pipeline for a work item that already has one
- **WHEN** a pipeline is requested for a work item that already has an associated pipeline
- **THEN** the request is rejected
