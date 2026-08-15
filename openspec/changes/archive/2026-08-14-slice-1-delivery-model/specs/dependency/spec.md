# Spec: Dependency Entity

## Overview

A dependency is a first-class relationship between work items: "A depends on B" means B must be complete before A can proceed. Includes cycle detection.

## Required Behavior

### Data Schema

`Dependency` (new model):
- **`id`** (PK)
- **`workItemId`** (FK to WorkItem): the dependent (A, depends on others).
- **`dependsOnWorkItemId`** (FK to WorkItem): the dependency target (B, others depend on it).
- **`reason`** (string): plain-language explanation. E.g., "Needs design from design team", "Requires architecture approval".
- **`createdAt`**, **`updatedAt`** (datetime).
- **Unique constraint**: `(workItemId, dependsOnWorkItemId)` — no duplicate dependencies.

### Commands

**`addDependency(input: AddDependencyInput)`**
- Input: `workItemId` (dependent), `dependsOnWorkItemId` (target), `reason`.
- Validation: both work items must exist in the same project; check for cycles (if adding A→B, B must not already have a path to A, directly or transitively).
- Authorization: Project Manager+ or owner of the dependent work item.
- Transaction: insert `Dependency`, record `DEPENDENCY_ADDED` audit event.
- Return: created `Dependency`.

**`removeDependency(id: string)`**
- Remove a dependency relationship.
- Validation: must exist.
- Authorization: Project Manager+ or owner of the dependent work item.
- Transaction: delete `Dependency`, record `DEPENDENCY_REMOVED` audit event.
- Return: deleted `Dependency`.

**`updateDependency(id: string, reason: string)`**
- Update the dependency reason.
- Authorization: Project Manager+ or owner of the dependent work item.
- Transaction: update, record `DEPENDENCY_UPDATED` audit event.
- Return: updated `Dependency`.

### Queries

**`getWorkItemDependencies(workItemId: string)`**
- Return both directions:
  - **`dependsOn`**: items this work item depends on (upstream).
  - **`dependedOnBy`**: items that depend on this work item (downstream).
- Each includes the reason and links.

**`detectCycles(workItemId: string, candidateTargetId: string): boolean`**
- Check if adding a dependency from `workItemId` to `candidateTargetId` would create a cycle.
- Used during validation in `addDependency`.

**`getCriticalPath(projectId: string): WorkItem[]`**
- Return the longest dependency chain in the project (topologically sorted). Preparation for Slice 2 critical path feature (not fully built in Slice 1).

### Constraints

- Cycles are forbidden: validate with `detectCycles` before insertion.
- A work item cannot depend on itself.
- Both items in a dependency must be in the same project.
- Every dependency must have a reason (non-empty string).
- Dependencies are directional: A→B does not imply B→A.

### UI Rendering

**Dependencies Tab** (360° Record):
- **Upstream** ("Depends on"): list of work items this item depends on, with reasons and links.
- **Downstream** ("Depended on by"): list of work items that depend on this item.
- **Add dependency**: button to add a new upstream dependency (search for work item, enter reason).
- **Remove dependency**: button on each row (if authorized).

**Dependency Visualization** (separate view or dashboard widget):
- Directed graph: nodes are work items, edges are dependencies.
- Edge labels show the dependency reason.
- Selecting a node highlights it (green), upstream nodes (blue), downstream nodes (purple), and dims the rest.
- Tooltip on edge shows the reason.
- Must be explanatory, not decorative: a user must understand *why* B depends on A.

**Attention Center**: "Dependencies" group (future enhancement; not in Slice 1 scope, but reserved). E.g., "A depends on B which is blocked".

## Acceptance Criteria

- ✅ Prisma migration creates `Dependency` table with unique constraint.
- ✅ `addDependency` command checks for cycles and rejects if found.
- ✅ `removeDependency` command removes the relationship.
- ✅ Queries return both upstream and downstream dependencies with reasons.
- ✅ Dependencies are displayed in the Dependencies tab with links.
- ✅ Dependency graph visualization shows nodes and edges with reasons.
- ✅ Selecting a node in the graph highlights related nodes and dims others.
- ✅ Tests cover: add dependency, add duplicate (rejected), add cycle (rejected), remove, cycle detection algorithm.
- ✅ E2E test: create two work items, add dependency with reason, view in Dependencies tab, verify graph visualization.
