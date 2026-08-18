# dashboard Specification

## Purpose
Turns the home page into a command center — an attention summary, quick
access to projects, and recent activity — so a user's first view answers
"what needs me" before "what exists."

## Requirements

### Requirement: The dashboard shows an attention summary
The system SHALL render, on the home page, counts of pending decisions,
active blockers, high/critical risks, and upcoming deadlines as stat
tiles (an icon badge in that count's status color, the count, and a
label), each linking into the corresponding Attention Center section, or
an all-clear state when every count is zero.

#### Scenario: Counts link to the Attention Center
- **WHEN** the dashboard shows a nonzero blocker count
- **THEN** clicking it navigates to the Attention Center's blockers section

#### Scenario: A stat tile carries a status-colored icon badge
- **WHEN** the dashboard renders the blocker count as a stat tile
- **THEN** its icon badge renders in the critical status color, not the
  small plain-text pill used before this change

### Requirement: Project quick-access cards carry a stable identity color and AI budget usage
The system SHALL render each project quick-access card with its stable
per-project identity color (see the design-system capability's identity-
color requirement) and, for each client section, an AI-budget-usage
meter (a track-and-progress indicator, not a multi-slice pie) showing
the proportion of that client's effective AI budget already spent, built
from existing AI cost and budget data — SHALL NOT introduce a new metric
or a new stored field for this display.

#### Scenario: A client's budget usage renders as a meter
- **WHEN** a client has an effective AI budget and some recorded AI cost
- **THEN** the dashboard's client section shows a usage meter of the
  proportion used, matching the same effective-budget value already
  shown elsewhere (e.g. the Configuration Center)

#### Scenario: A client with no budget set shows no meter
- **WHEN** a client's effective AI budget is unset (no limit)
- **THEN** no budget-usage meter is rendered for that client, rather than
  a meter implying a 0%-or-undefined usage

### Requirement: A client section shows who has access to it
The system SHALL render, in each Dashboard client section's header, an
overlapping avatar stack of that client's team members (drawn from
existing `ClientMembership` data, not a new stored field), rendering an
overflow count when the membership exceeds the stack's visible slots, and
rendering nothing when the client has no members. SHALL NOT be shown per
project card or per Attention Center row, since neither has real
multi-person "who's involved" data in this domain (a work item carries at
most one optional owner, not a members list).

#### Scenario: A client with team members shows an avatar stack
- **WHEN** a client section renders for a client with one or more
  `ClientMembership` records
- **THEN** the section's header shows an avatar stack of those members,
  each rendered as an initials fallback (no avatar images exist in this
  app)

#### Scenario: A client with more members than visible slots shows an overflow count
- **WHEN** a client has more members than the stack's visible slot limit
- **THEN** the stack shows the visible members plus a "+N" overflow badge
  for the rest

### Requirement: A persistent primary action is available from the dashboard header
The system SHALL render a persistent, always-visible primary action in
the dashboard's header that starts work-item creation (selecting a
project as part of that same flow when one isn't already implied), in
addition to the existing per-project page-body creation forms, which
remain functional and unchanged.

#### Scenario: The header CTA reaches work-item creation without prior scrolling
- **WHEN** a user clicks the dashboard header's primary CTA
- **THEN** they can create a work item without first scrolling to find
  and open a specific project's own section

### Requirement: The dashboard shows project quick access and recent activity
The system SHALL render a quick-access list of the user's most recently
active projects (name, client, work-item count, last-activity time) and a
feed of the ten most recent audit events across the user's accessible
clients, each linking to the affected work item where one exists.

#### Scenario: Recent activity reflects a just-created event
- **WHEN** a work item is created and the dashboard is then loaded
- **THEN** the creation event appears in the recent-activity feed

### Requirement: Existing project-management functionality is preserved
The system SHALL continue to expose project creation, work-item creation,
and integration sync from the home page — the dashboard summary sections
are added above this functionality, not a replacement for it, since it
remains the only UI able to perform those actions.

#### Scenario: A project can still be created from the dashboard
- **WHEN** a user submits the "Add project" form on the home page
- **THEN** the project is created, exactly as before the dashboard summary sections were added

### Requirement: The dashboard renders fully in the active locale
The system SHALL render the attention-summary labels, the project
quick-access list, and the recent-activity feed (including every audit
event's description and timestamp) in the active locale, and SHALL
format the recent-activity timestamps per that locale's date/time
conventions.

#### Scenario: Dashboard summary in Hebrew
- **WHEN** Hebrew is the active locale and a user views the dashboard
- **THEN** the attention-summary labels (e.g. blocker and decision
  counts) and the recent-activity feed's text and timestamps render in
  Hebrew
