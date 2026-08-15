## MODIFIED Requirements

### Requirement: The 360° Record has Overview, Dependencies, and Timeline tabs
The system SHALL render, at a route keyed by work item ID, an Overview tab
(type, status with explanation, owner, executor, due date, progress,
risk, priority, active blocker/decision panel, AI cost, parent/children),
a Dependencies tab (upstream/downstream lists plus a dependency graph),
and a Timeline tab (paginated audit events for that item), navigable via
an accessible tab list. Arrow-key navigation between tabs SHALL follow
logical reading order (next/previous), not a physically fixed key
mapping, so it reverses under a right-to-left locale.

#### Scenario: Tabs are keyboard-navigable
- **WHEN** a tab button has focus and the user presses the right or left
  arrow key
- **THEN** focus and the active panel move to the next or previous tab

#### Scenario: Arrow-key direction follows reading order under RTL
- **WHEN** Hebrew is the active locale and a tab button has focus
- **THEN** the arrow key that is visually adjacent to the next tab in
  right-to-left reading order moves focus to that next tab, and the
  opposite arrow moves to the previous tab — the same logical
  next/previous behavior as under English, not a key mapping fixed to
  physical left/right

## ADDED Requirements

### Requirement: Overview, Dependencies, and Timeline tab content renders in the active locale
The system SHALL render every field label, status explanation, and date
(due date, blocked-since, audit-event timestamps) on the Overview,
Dependencies, and Timeline tabs in the active locale, with dates formatted
per that locale's conventions.

#### Scenario: Overview tab in Hebrew
- **WHEN** Hebrew is the active locale and a user opens a work item's
  Overview tab
- **THEN** its status, risk, and priority labels, field names, and due
  date render in Hebrew, with the due date formatted per Hebrew-locale
  conventions
