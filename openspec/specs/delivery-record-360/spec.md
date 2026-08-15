# delivery-record-360 Specification

## Purpose
Gives a work item a comprehensive, tabbed detail page — overview,
dependencies (with a visual graph), and timeline — with honest
"coming soon" placeholders for the parts not yet built, rather than
fabricated data.

## Requirements

### Requirement: The 360° Record has Overview, Dependencies, and Timeline tabs
The system SHALL render, at a route keyed by work item ID, an Overview tab
(type, status with explanation, owner, executor, due date, progress,
risk, priority, active blocker/decision panel, AI cost, parent/children),
a Dependencies tab (upstream/downstream lists plus a dependency graph),
and a Timeline tab (paginated audit events for that item), navigable via
an accessible tab list.

#### Scenario: Tabs are keyboard-navigable
- **WHEN** a tab button has focus and the user presses the right or left arrow key
- **THEN** focus and the active panel move to the next or previous tab

### Requirement: Unbuilt tabs show an honest empty state, never fabricated data
The system SHALL render Code, Tests, Evidence, and Configuration tabs with
an explicit "coming soon" message describing what each will eventually
show, and SHALL NOT populate them with placeholder or mock data.

#### Scenario: The Code tab shows a coming-soon message
- **WHEN** a user opens the Code tab on any work item's 360° Record
- **THEN** an honest "coming soon" message is shown, with no fabricated code or file data

### Requirement: Authorized users can edit the work item and create blockers or decisions from the Overview tab
The system SHALL show Edit, Create Blocker, and Create Decision actions on
the Overview tab only to users with write-capable role access on the work
item's client, and SHALL hide Create Blocker/Create Decision once an
active blocker or pending decision already exists.

#### Scenario: A read-only user sees no action buttons
- **WHEN** a user with only viewer access views a work item's Overview tab
- **THEN** no Edit, Create Blocker, or Create Decision button is shown

### Requirement: Deleting a work item is not offered
The system SHALL NOT offer a delete action for a work item, because
deleting one would cascade through its pipeline to its audit events,
which must remain immutable; this requires a schema decision (soft
delete, or decoupling the cascade) not made in this slice.

#### Scenario: No delete button appears on the Overview tab
- **WHEN** any user, regardless of role, views a work item's Overview tab
- **THEN** no delete action is offered

### Requirement: The Timeline tab paginates without a hard cutoff
The system SHALL page the work item's audit events at 20 per page with no
upper limit on how many pages are reachable.

#### Scenario: A work item with more than 20 events is fully reachable
- **WHEN** a work item has more than 20 audit events and a user pages past the first page
- **THEN** the remaining events are shown on subsequent pages
