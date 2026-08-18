## ADDED Requirements

### Requirement: A client detail view shows its top-level, open work items
The system SHALL provide, in the client detail view, a "Tasks" section listing every `WorkItem`
across the client's projects with no parent (top-level) and an open status (not `COMPLETED` or
`CLOSED`), spanning every work-item type, and SHALL NOT list a WorkItem that has a parent even
when its top-level ancestor is shown in the same section.

#### Scenario: A top-level open work item appears
- **WHEN** a client has a `WorkItem` with no parent and a status other than `COMPLETED`/`CLOSED`
- **THEN** it appears in the client detail view's Tasks section

#### Scenario: A child work item does not appear even when its parent does
- **WHEN** a client has a `WorkItem` with a parent, and that parent itself has no parent (i.e. the
  parent is top-level and appears in the Tasks section)
- **THEN** the child WorkItem does not get its own row in the Tasks section

#### Scenario: Every work-item type is included, not only Tasks
- **WHEN** a client's top-level open work spans multiple work-item types (e.g. a `PROJECT`-typed
  WorkItem, a `TASK`, and a `BUG`, each with no parent)
- **THEN** all of them appear in the Tasks section, not only items of type `TASK`

#### Scenario: A completed or closed top-level work item is excluded
- **WHEN** a client has a top-level `WorkItem` whose status is `COMPLETED` or `CLOSED`
- **THEN** it does not appear in the Tasks section

#### Scenario: The Tasks section is distinct from the existing Projects panel
- **WHEN** a user views a client's detail page
- **THEN** the Tasks section (top-level WorkItems of any type) and the existing Projects panel
  (the client's `Project` model entities) are shown as separate sections, and neither list is
  derived from or replaces the other
