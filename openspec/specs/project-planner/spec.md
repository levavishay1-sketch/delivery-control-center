# project-planner Specification

## Purpose

Gives a project a whole-work view — every WorkItem and every dependency among them, switchable
between a graph and a status-lane board — instead of dependency visibility existing only per item
inside the 360° Record, with a computed signal for which items are safe to start now.

## Requirements

### Requirement: A project's full work graph is viewable, not just one item's neighborhood
The system SHALL show a user with read access to a project every WorkItem in that project and
every Dependency edge among them, in a graph visualization supporting pan/zoom and a focus mode
that highlights a selected item's upstream and downstream dependencies.

#### Scenario: Viewing a project's work graph
- **WHEN** a user with read access to a project opens its Planner page's Graph view
- **THEN** they see every WorkItem in the project and every Dependency edge among them

#### Scenario: Focusing an item highlights its dependency chain
- **WHEN** a user selects a WorkItem node in the Planner's Graph view
- **THEN** its upstream and downstream dependency chain is visually highlighted, distinct from
  unrelated items

### Requirement: A WorkItem ready to start is distinguished from one blocked on a dependency
The system SHALL compute, for each WorkItem shown in the Planner, whether it is ready to start now
— in `OPEN` or `IN_PROGRESS` status with every upstream dependency already `COMPLETED` or
`CLOSED` — and SHALL visually distinguish ready items from those still blocked on an unresolved
dependency.

#### Scenario: An item with no unresolved dependencies is marked ready
- **WHEN** a WorkItem in `OPEN` status has no Dependency, or every Dependency it has is on an
  already-`COMPLETED` item
- **THEN** it is marked ready to start in the Planner

#### Scenario: An item with an unresolved dependency is not marked ready
- **WHEN** a WorkItem depends on another WorkItem that is not yet `COMPLETED` or `CLOSED`
- **THEN** it is not marked ready to start in the Planner

### Requirement: A project's work is also viewable as a status-lane board
The system SHALL allow a user with read access to a project to switch the Planner between the
Graph view and a status-lane board view, grouping the project's WorkItems by their `WorkStatus`,
with each card navigable to that item's own detail view. The system SHALL NOT allow changing a
WorkItem's status by moving its card between lanes in this view.

#### Scenario: Switching to the Board view
- **WHEN** a user switches the Planner from Graph to Board view
- **THEN** the project's WorkItems are shown grouped into lanes by their current status

#### Scenario: Opening an item's detail from the board
- **WHEN** a user clicks a WorkItem card in the Board view
- **THEN** they are taken to that WorkItem's own detail view

#### Scenario: The board does not support drag-and-drop status changes
- **WHEN** a user views the Board
- **THEN** no control on the board changes a WorkItem's status directly — status changes still
  require the WorkItem's own existing status-change action
