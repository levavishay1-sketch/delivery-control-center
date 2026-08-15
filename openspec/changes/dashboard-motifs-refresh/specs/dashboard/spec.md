## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Project quick-access cards carry a stable identity color and AI budget usage
The system SHALL render each project quick-access card with its stable
per-project identity color (see the design-system capability's identity-
color requirement) and, for each client section, an AI-budget-usage
donut showing the proportion of that client's effective AI budget
already spent, built from existing AI cost and budget data — SHALL NOT
introduce a new metric or a new stored field for this display.

#### Scenario: A client's budget usage renders as a donut
- **WHEN** a client has an effective AI budget and some recorded AI cost
- **THEN** the dashboard's client section shows a donut chart of the
  proportion used, matching the same effective-budget value already
  shown elsewhere (e.g. the Configuration Center)

#### Scenario: A client with no budget set shows no donut
- **WHEN** a client's effective AI budget is unset (no limit)
- **THEN** no budget-usage donut is rendered for that client, rather than
  a donut implying a 0%-or-undefined usage

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
