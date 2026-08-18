# audit-trail-fixed Specification

## Purpose
Fixes the audit trail's silent 200-row truncation with real filtering and
pagination, so the system's transparency guarantee holds for established
projects with long histories, not just new ones.

## Requirements

### Requirement: The audit trail has no hard row cutoff
The system SHALL page through every audit event the requesting user can
access, with no upper limit on how many pages are reachable, replacing the
prior 200-row hard cap.

#### Scenario: An event beyond the old 200-row cap is reachable
- **WHEN** a project has more than 200 audit events and a user pages past the 200th
- **THEN** the remaining events are still shown, in pages of the selected size

### Requirement: Rows per page is user-selectable
The system SHALL let the user choose 20, 50, or 100 rows per page.

#### Scenario: Selecting 100 rows per page
- **WHEN** a user selects 100 as the page size
- **THEN** up to 100 events are shown per page instead of the default 20

### Requirement: The trail can be filtered by project, actor, action category, and date range
The system SHALL let the user filter by project (scoped to their
accessible projects), by actor (scoped to actors with at least one event
in the current scope, narrowing further when a project is selected), by a
coarse action category, and by a date range; filters combine with AND.

#### Scenario: Filtering by action category
- **WHEN** a user filters to the "Blocker Created" category
- **THEN** only events recording a blocker's creation are shown

#### Scenario: The actor list narrows to the selected project
- **WHEN** a user selects a project filter
- **THEN** the actor dropdown offers only actors who have at least one event in that project

### Requirement: The action category filter classifies free-text events, it is not a stored code
The system SHALL classify `AuditEvent.action`'s free-text sentence into a
fixed set of categories for filtering purposes, since the underlying field
has always been a human-readable description rather than a stored action
code; a new action template introduced later needs a matching category
added for the filter to catch it.

#### Scenario: An event matching a category's substring is classified
- **WHEN** an audit event's action text contains the substring associated with the "Decision Approved" category
- **THEN** filtering by that category includes the event

### Requirement: Each row states timestamp, actor, action, and object
The system SHALL show, for every audit row, an absolute timestamp, the
actor's name, the action description, and — where the event is linked to
a work item or pipeline — a link to that object.

#### Scenario: A work-item-linked event shows a link
- **WHEN** an audit row is linked to a work item
- **THEN** the row includes a link to that work item's detail page
