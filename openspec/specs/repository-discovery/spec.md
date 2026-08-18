# repository-discovery Specification

## Purpose

Gives a repository a persistent, evidence-backed understanding of what it is — purpose, stack,
structure, and conventions — instead of the opaque owner/name row it is today, produced by an
explicitly-triggered AI analysis and never treated as a substitute for reading live source.

## Requirements

### Requirement: A user can trigger a Discovery run for a repository
The system SHALL allow a write-capable user to explicitly trigger a Discovery run for a
repository. The system SHALL NOT run Discovery automatically on repository link/connect or on any
other implicit trigger.

#### Scenario: Triggering Discovery on a repository with none yet
- **WHEN** a write-capable user triggers Discovery on a repository that has no prior
  `RepositoryDiscovery`
- **THEN** a new Discovery run starts for that repository

#### Scenario: Triggering a fresh Discovery run on an already-analyzed repository
- **WHEN** a write-capable user triggers Discovery on a repository that already has a completed
  `RepositoryDiscovery`
- **THEN** a new Discovery run starts, creating a new version rather than overwriting the prior one

#### Scenario: A read-only user cannot trigger Discovery
- **WHEN** a user without write access to the repository's client attempts to trigger Discovery
- **THEN** the request is refused

### Requirement: Discovery gathers real evidence from the repository before analysis
The system SHALL fetch the repository's root directory listing, its README file if present, and
any present dependency-manifest file, from the source-control provider, before producing a
Discovery analysis. Every major claim in the analysis (purpose, stack, structure, modules, APIs,
data stores, testing, conventions) SHALL cite the evidence (fetched file paths) that supports it.
Anything the fetched evidence cannot establish SHALL appear in an explicit `unknowns` list rather
than be asserted without support.

#### Scenario: A claim is grounded in fetched evidence
- **WHEN** a Discovery run's analysis states the repository's stack
- **THEN** that claim names which fetched file(s) (e.g. a manifest file) support it

#### Scenario: Unsupported areas are named as unknown, not guessed
- **WHEN** the fetched evidence does not establish something about the repository (e.g. its
  internal module structure, when no manifest or root listing entry indicates it)
- **THEN** that area appears in the Discovery run's unknowns rather than as an asserted claim

### Requirement: A Discovery run's AI output is validated before being stored
The system SHALL validate a Discovery run's AI-produced findings against a defined schema before
writing them as a `RepositoryDiscovery` record's content. A response that fails validation SHALL
be treated as a failed run, not partially or silently accepted.

#### Scenario: A well-formed AI response is stored
- **WHEN** a Discovery run's AI output matches the expected findings schema
- **THEN** it is stored as that run's findings and the run is marked succeeded

#### Scenario: A malformed AI response fails the run
- **WHEN** a Discovery run's AI output does not match the expected findings schema
- **THEN** the run is marked failed with an error, and no `RepositoryDiscovery` content is stored
  from that attempt

### Requirement: Discovery runs are durable and retried like every other AI drafting job
The system SHALL execute a Discovery run through the same durable, retried job runtime every
other AI-drafting action in the product uses — a run in progress survives a process restart, and a
transient failure is retried with backoff before the run is marked permanently failed.

#### Scenario: A worker restart does not lose an in-progress Discovery run
- **WHEN** the worker process restarts while a Discovery run is in progress
- **THEN** the run resumes and completes without being lost or duplicated

#### Scenario: Retries are exhausted
- **WHEN** every retry attempt for a Discovery run fails
- **THEN** the run is marked permanently failed with the last error recorded

### Requirement: Every Discovery run is versioned and audited
The system SHALL record each Discovery run as its own version for the repository, preserving every
prior version rather than overwriting it, and SHALL record an audit event for a run's start and
for its completion or failure.

#### Scenario: A repository's Discovery history is retrievable
- **WHEN** a repository has been analyzed by Discovery more than once
- **THEN** every prior version's findings remain retrievable, not just the latest

#### Scenario: Discovery activity appears in the audit trail
- **WHEN** a Discovery run starts and later completes
- **THEN** both events are recorded in the audit trail

### Requirement: A repository's current context is visible, labeled with its age
The system SHALL show a repository's latest successful Discovery findings as its current
`RepositoryContext` on a repository detail view, labeled with when that Discovery run completed,
and SHALL present this summary as informational rather than as a substitute for verifying against
the live source.

#### Scenario: Viewing a repository with a completed Discovery run
- **WHEN** a user with read access to the repository's client opens its detail view
- **THEN** they see the latest Discovery findings and when that run completed

#### Scenario: Viewing a repository with no Discovery run yet
- **WHEN** a user opens the detail view of a repository that has never had a Discovery run
- **THEN** they see an empty state explaining none has run yet, with a "Run Discovery" action
  available to a write-capable user
