# dashboard Specification

## Purpose
Turns the home page into a command center — an attention summary, quick
access to projects, and recent activity — so a user's first view answers
"what needs me" before "what exists."

## Requirements

### Requirement: The dashboard shows an attention summary
The system SHALL render, on the home page, counts of pending decisions,
active blockers, high/critical risks, and upcoming deadlines, each linking
into the corresponding Attention Center section, or an all-clear state
when every count is zero.

#### Scenario: Counts link to the Attention Center
- **WHEN** the dashboard shows a nonzero blocker count
- **THEN** clicking it navigates to the Attention Center's blockers section

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
