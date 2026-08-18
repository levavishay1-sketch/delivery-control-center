## Purpose

Maintains a weekly, dated snapshot of Claude model pricing/capability/context-window facts fetched
from Anthropic's official documentation, and uses it to recommend which model should execute a
given AI-executed WorkItem and why — so AI-execution cost estimates and model choice are grounded
in current information rather than a hardcoded constant that silently goes stale.

## ADDED Requirements

### Requirement: A model knowledge snapshot is fetched weekly from the official source
The system SHALL fetch `https://platform.claude.com/docs/en/about-claude/models/overview` every
Sunday at 07:00 and extract available models' pricing, context-window size, and capability facts
into a dated `ModelSnapshot` record, reusing the existing Job runtime's scheduling rather than a
new scheduling mechanism.

#### Scenario: A weekly snapshot is produced
- **WHEN** Sunday 07:00 arrives
- **THEN** the system fetches the source page and records a new `ModelSnapshot` with the models it
  extracted and a fetched-at timestamp

#### Scenario: The job reschedules itself for the following week
- **WHEN** a snapshot fetch attempt completes, whether it succeeds or fails
- **THEN** the system enqueues the next weekly fetch for the following Sunday 07:00, so the job
  keeps running without external scheduling infrastructure

### Requirement: A failed extraction never silently presents fabricated data
The system SHALL record a snapshot attempt's outcome as success or failure, and SHALL NOT treat a
failed or partial extraction as a valid snapshot for a model recommendation to read from.

#### Scenario: A source-page structure change causes extraction to fail
- **WHEN** the weekly fetch cannot extract recognizable model/pricing information from the source
  page
- **THEN** the system records the attempt as failed, and the most recent successful snapshot
  remains the one model recommendations read from

#### Scenario: No snapshot exists yet
- **WHEN** no successful `ModelSnapshot` has ever been recorded
- **THEN** model recommendations fall back to the product's existing hardcoded cost assumption
  rather than failing outright

### Requirement: A model recommendation for AI-executed work cites current, dated information
The system SHALL recommend a model for a WorkItem whose executor is AI, with reasoning that cites
the pricing/capability facts from the latest successful `ModelSnapshot` and that snapshot's fetch
date, so the recommendation's freshness is visible rather than assumed.

#### Scenario: A recommendation cites the snapshot it was computed from
- **WHEN** a model recommendation is shown for an AI-executed WorkItem
- **THEN** it states which model is proposed, why, and the date of the snapshot the reasoning is
  based on

#### Scenario: An out-of-date snapshot's age is still shown as-is
- **WHEN** the latest successful snapshot is older than one week (e.g. a weekly run was missed)
- **THEN** the recommendation still shows that snapshot's actual fetch date rather than hiding or
  fabricating a more recent one
