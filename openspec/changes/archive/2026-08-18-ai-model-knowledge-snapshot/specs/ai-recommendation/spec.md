## MODIFIED Requirements

### Requirement: An AI recommendation always states what, why, assumptions, and estimates
The system SHALL render any AI recommendation using a shared card shape carrying: what is
recommended, the reasoning in plain language, the assumptions used to reach it, an estimated time
when execution is involved, and an estimated cost whenever AI execution is a candidate option —
shown even when AI is not the recommended choice. When a recommendation's reasoning is grounded in
information that can go stale (e.g. a weekly-refreshed knowledge snapshot), the card SHALL show how
current that information is, not merely cite it without a freshness indicator.

#### Scenario: A recommendation always shows the AI-execution estimate
- **WHEN** the system recommends a developer as executor for a WorkItem
- **THEN** the card still shows the estimated time and cost for the AI-execution alternative

#### Scenario: A recommendation states its reasoning and assumptions
- **WHEN** a recommendation is shown for a WorkItem
- **THEN** the card shows a plain-language reason and the assumptions the recommendation was based
  on, not just a bare verdict

#### Scenario: A recommendation grounded in dated information shows its freshness
- **WHEN** a recommendation's reasoning cites a source that can go stale (e.g. a weekly model
  knowledge snapshot)
- **THEN** the card shows how current that source is (e.g. the snapshot's fetch date)

## ADDED Requirements

### Requirement: A WorkItem's AI model recommendation is shown when AI is the executor
The system SHALL show a model recommendation, using the shared AI-recommendation card shape, for
any WorkItem whose `executorType` is `AI_AGENT`, complementing the existing AI-vs-developer
executor recommendation shown when `executorType` is `UNASSIGNED` — the two card instances are
mutually exclusive per WorkItem, since a WorkItem is never simultaneously unassigned and AI-
executed.

#### Scenario: A model recommendation is shown for an AI-executed WorkItem
- **WHEN** a user views a WorkItem whose `executorType` is `AI_AGENT`
- **THEN** the system shows a model recommendation for that item

#### Scenario: No model recommendation is shown for a non-AI-executed WorkItem
- **WHEN** a user views a WorkItem whose `executorType` is not `AI_AGENT`
- **THEN** no model recommendation card is shown for that item
