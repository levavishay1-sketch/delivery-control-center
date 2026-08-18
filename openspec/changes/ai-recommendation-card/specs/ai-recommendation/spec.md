## Purpose

Gives every AI-facing recommendation in the product one shared shape — What/Why/Assumptions/
Estimated time/Estimated cost/What happens under each alternative/a single override action — and
its first concrete instance: an AI-vs-developer executor recommendation for an unassigned
WorkItem, driven entirely by signals the product already has.

## ADDED Requirements

### Requirement: An AI recommendation always states what, why, assumptions, and estimates
The system SHALL render any AI recommendation using a shared card shape carrying: what is
recommended, the reasoning in plain language, the assumptions used to reach it, an estimated time
when execution is involved, and an estimated cost whenever AI execution is a candidate option —
shown even when AI is not the recommended choice.

#### Scenario: A recommendation always shows the AI-execution estimate
- **WHEN** the system recommends a developer as executor for a WorkItem
- **THEN** the card still shows the estimated time and cost for the AI-execution alternative

#### Scenario: A recommendation states its reasoning and assumptions
- **WHEN** a recommendation is shown for a WorkItem
- **THEN** the card shows a plain-language reason and the assumptions the recommendation was based
  on, not just a bare verdict

### Requirement: A WorkItem's AI-vs-developer executor recommendation is computed from existing signals
The system SHALL compute an AI-vs-developer executor recommendation for a WorkItem with no
executor assigned yet, using the WorkItem's `risk`, `priority`, and `type`, and historical
`AgentRun` cost/token/duration data, without requiring any new signal to exist first.

#### Scenario: A recommendation is shown for an unassigned WorkItem
- **WHEN** a user views a WorkItem whose `executorType` is `UNASSIGNED`
- **THEN** the system shows an AI-vs-developer executor recommendation for that item

#### Scenario: No recommendation is shown once an executor is already assigned
- **WHEN** a user views a WorkItem whose `executorType` is not `UNASSIGNED`
- **THEN** no executor recommendation card is shown for that item

#### Scenario: The estimate is grounded in historical data, not fabricated
- **WHEN** the system computes an estimated cost/time for the AI-execution alternative
- **THEN** the estimate is derived from actual historical `AgentRun` records, not a hardcoded
  constant

### Requirement: The manager's executor choice is never blocked by the recommendation
The system SHALL let the user choose either alternative (AI or developer) as the WorkItem's
executor via a single override action, with neither alternative pre-selected, and SHALL apply the
chosen executor using the WorkItem's existing executor-assignment behavior.

#### Scenario: Choosing the recommended alternative
- **WHEN** a user chooses the recommended alternative from the card
- **THEN** the WorkItem's executor is set accordingly

#### Scenario: Overriding the recommendation
- **WHEN** a user chooses the alternative the card did not recommend
- **THEN** the WorkItem's executor is still set to the user's choice — the recommendation does not
  block the override

#### Scenario: Neither alternative is pre-selected
- **WHEN** a user views the recommendation card
- **THEN** neither the AI nor the developer alternative is pre-selected — the user must actively
  choose one
