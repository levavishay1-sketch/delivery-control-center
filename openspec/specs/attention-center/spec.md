# attention-center Specification

## Purpose
Aggregates every item across a user's accessible clients that needs a
human decision or action — pending decisions, active blockers,
high/critical risks, upcoming deadlines, and review gates — into one
screen, with the reason always visible.

## Requirements

### Requirement: The Attention Center aggregates five groups across accessible clients
The system SHALL aggregate, scoped to every client the requesting user can
access (all clients for an org admin), open decisions, active blockers,
work items with risk `HIGH` or `CRITICAL`, work items due within 7 days,
and work items with status `REVIEW`.

#### Scenario: A blocker in an accessible project appears
- **WHEN** a user with membership on a client requests the Attention Center
- **THEN** any active blocker on a work item in that client's projects appears in the Blockers group

#### Scenario: An item in an inaccessible client is excluded
- **WHEN** a user requests the Attention Center
- **THEN** no item from a client the user has no membership on (and is not an org admin for) appears in any group

### Requirement: Every row states why it needs attention
The system SHALL render, for every row in every group, the reason it
appears — a blocker's reason and required action, a decision's question
and reason, a risk's level, or a deadline's due date — never a bare status
badge with no explanation.

#### Scenario: A blocker row shows its reason
- **WHEN** a blocker appears in the Attention Center's Blockers group
- **THEN** its reason and required action are rendered on that row, not just a "Blocked" label

### Requirement: Groups are sorted by urgency
The system SHALL order decisions and deadlines by how soon they're due
(earliest/most overdue first) and blockers by how long they've been
active (oldest first).

#### Scenario: The oldest blocker sorts first
- **WHEN** the Blockers group has two active blockers with different `blockedSince` timestamps
- **THEN** the older one is listed first

### Requirement: An all-clear state is shown when nothing needs attention
The system SHALL render an explicit "all clear" state when every group is
empty, rather than an empty page.

#### Scenario: No attention items exist
- **WHEN** a user with no pending decisions, active blockers, high/critical risks, upcoming deadlines, or review-gate items requests the Attention Center
- **THEN** an all-clear message is shown instead of five empty sections

### Requirement: The Attention Center renders fully in the active locale, in correct reading order
The system SHALL render every group heading, row reason, and required-
action text in the active locale, and SHALL lay out each row's status
indicator, label, and reason text in the order matching the active
locale's reading direction.

#### Scenario: Attention Center in Hebrew
- **WHEN** Hebrew is the active locale and a user views the Attention
  Center
- **THEN** every group heading and every row's reason/required-action
  text renders in Hebrew, and each row's status indicator appears at the
  reading-order start position for right-to-left
