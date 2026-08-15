## Purpose

Promotes the Constitution from a per-work-item pipeline stage into a
project-scoped, versioned artifact drafted once per project and
referenced by every pipeline started under it.

## ADDED Requirements

### Requirement: A project's Constitution is versioned, never overwritten in place
The system SHALL create a new version when a project's Constitution is
redrafted, preserving every prior version rather than replacing its
content.

#### Scenario: Redrafting creates a new version
- **WHEN** a project's Constitution is redrafted after an earlier version was already approved
- **THEN** a new version is created and the earlier version's content remains unchanged and retrievable

### Requirement: Starting a pipeline requires an approved Constitution
The system SHALL refuse to start a pipeline for a work item whose project
has no approved Constitution version.

#### Scenario: Starting a pipeline without an approved Constitution
- **WHEN** a pipeline is started for a work item in a project with no approved Constitution
- **THEN** the request is rejected with an error pointing at drafting one

### Requirement: A pipeline records which Constitution version it started under
The system SHALL, when a pipeline is started, record the project's
currently-approved Constitution version on the pipeline, so a later
Constitution redraft does not retroactively change what an in-flight
pipeline is understood to have run against.

#### Scenario: A later Constitution redraft does not affect an existing pipeline
- **WHEN** a project's Constitution is redrafted and approved as a new version after a pipeline has already started
- **THEN** that existing pipeline's recorded Constitution version is unchanged
