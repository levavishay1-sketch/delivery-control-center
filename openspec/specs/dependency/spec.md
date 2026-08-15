# dependency Specification

## Purpose
Represents "A depends on B" as a first-class, directed relationship
between work items in the same project, with cycle detection, so
delivery order can be modeled and visualized.

## Requirements

### Requirement: A dependency links two work items in the same project
The system SHALL allow a dependency to be added between two work items
only when both exist in the same project, and SHALL reject a
self-dependency or a duplicate of an existing pair.

#### Scenario: A valid dependency is added
- **WHEN** `addDependency` is called with two distinct work items in the same project and a reason
- **THEN** the dependency is created and an audit event records the reason

#### Scenario: A self-dependency is rejected
- **WHEN** `addDependency` is called with the same work item as both sides
- **THEN** the request is rejected

#### Scenario: A duplicate dependency is rejected
- **WHEN** `addDependency` is called for a pair that already has a dependency between them
- **THEN** the request is rejected

#### Scenario: A cross-project dependency is rejected
- **WHEN** `addDependency` is called with two work items in different projects
- **THEN** the request is rejected

### Requirement: Adding a dependency that would create a cycle is rejected
The system SHALL check, before inserting a dependency from A to B, whether
a path already exists from B back to A through existing dependencies —
directly or transitively — and SHALL reject the insert if one does.

#### Scenario: A transitive cycle is rejected
- **WHEN** A already depends on B, and B already depends on C, and `addDependency` is called to make C depend on A
- **THEN** the request is rejected because it would close the A→B→C→A cycle

### Requirement: Dependencies are queryable in both directions
The system SHALL return, for a given work item, both the items it depends
on (upstream) and the items that depend on it (downstream), each with its
reason.

#### Scenario: Both directions are returned
- **WHEN** `getWorkItemDependencies` is called for a work item with one upstream and one downstream dependency
- **THEN** the result includes both, each carrying its own reason

### Requirement: The full connected dependency neighborhood is queryable for visualization
The system SHALL provide a query that returns every work item and
dependency edge reachable from a given item by following dependency edges
in either direction — not only its immediate neighbors — bounded by a
defensive node cap.

#### Scenario: A multi-hop chain is fully collected
- **WHEN** the neighborhood query is run from a leaf item in a 3-hop dependency chain
- **THEN** every item in the chain is returned, along with every edge connecting them

### Requirement: Removing a dependency requires write access
The system SHALL require write-capable role access to add or remove a
dependency.

#### Scenario: A read-only role cannot add a dependency
- **WHEN** a user with only viewer access attempts `addDependency`
- **THEN** the request is rejected

### Requirement: Critical path analysis is not yet implemented
The system SHALL expose a `getCriticalPath` query that currently returns
an empty result — full critical-path computation is explicitly deferred
to a later slice, not silently invented here.

#### Scenario: The stub returns an empty result
- **WHEN** `getCriticalPath` is called for any project
- **THEN** it returns an empty list rather than an error or fabricated data

### Requirement: Selecting a node in the dependency graph highlights its own upstream and downstream
The system SHALL render a work item's connected dependency neighborhood
as a directed graph and, when a node is selected, SHALL color it as
selected, color every node reachable from it via dependency edges as
upstream, color every node that can reach it via dependency edges as
downstream, and dim every other node — re-computed relative to whichever
node is currently selected, not fixed to the page's original item.

#### Scenario: Selecting a different node re-centers the highlight
- **WHEN** a user clicks a node that is not the page's original work item, inside a graph showing a 3-item dependency chain
- **THEN** that node becomes selected and the highlight colors recompute relative to it, not the original item

### Requirement: The graph is zoomable and pannable
The system SHALL let the user zoom (via scroll or dedicated controls) and
pan (via drag) the dependency graph, so a graph too large to fit the
viewport remains navigable.

#### Scenario: Zooming in enlarges the graph
- **WHEN** a user clicks the zoom-in control
- **THEN** the graph's nodes render larger within the same viewport
