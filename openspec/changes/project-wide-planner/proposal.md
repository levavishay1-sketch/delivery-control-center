## Roadmap Source

Implements old blueprint **Slice 16** (`docs/ROADMAP.md`, "Slices 11–21 — Product Vision & Flow
Blueprint"), scoped there as: "the Planner: a project-wide dependency map + status-lane board
(switchable), focus mode, and parallel-safe-task explanation. Extends `DependencyGraph.tsx`'s
existing layered-layout/focus engine (today scoped to one item's neighborhood inside the 360°
Record) to whole-project scope. Independent of 12–15; can proceed in parallel." Per
`docs/roadmap-sources/2026-08-17-core-product-definition-gap-analysis.md` Part 3:

> **16** — `project-wide-planner` ... §31 (Visual Work Graph) — close conceptual match, but the
> new spec's graph explicitly overlays Owner/Decision-Owner/Approval/Tests/Changes, which the old
> blueprint's Slice 16 didn't call out. **Still roughly accurate, extend field set** — least
> disrupted of the eight [old blueprint slices].

Chosen as the next slice over Slice 17 (AI Recommendation card) because Slice 17's own
gap-analysis assessment says it "should incorporate Blocker criticality (§35) and Execution
Readiness (§34) once those exist" — neither exists yet (Blocker severity deferred per Decision 7;
Execution Readiness doesn't exist at all) — while Slice 16 has no such blocking dependency and
extends a component that's already fully built.

## Why

`DependencyGraph.tsx` already renders a real dependency graph with layered layout, pan/zoom, and
focus/highlight — but only for one WorkItem's connected neighborhood, buried inside the 360°
Record. There's no way today to see a project's work as a whole: which items are ready to start in
parallel, which are blocked on something else finishing first, or how work is distributed across
status. This slice gives a project that whole-project view by wiring a new data source into the
existing graph component and adding a switchable status-lane board alongside it.

## What Changes

- New `getProjectWorkGraph(projectId)` query: every WorkItem in a project plus every `Dependency`
  edge among them, with a computed `readyToStart` flag per item (OPEN/IN_PROGRESS status, every
  upstream dependency already COMPLETED/CLOSED) — the "parallel-safe-task explanation."
- New `/projects/[id]/planner` page with a Graph ⇄ Board view switcher:
  - Graph view reuses `DependencyGraph.tsx` verbatim at project scope (its existing focus mode
    included, unchanged).
  - Board view: one status lane per `WorkStatus` value with items, read-only cards linking to each
    item's 360° Record — no drag-and-drop status editing in this slice.
- Linked from the Dashboard's existing project card (alongside "Constitution"/"Settings") and from
  Project Settings.

## Capabilities

### New Capabilities
- `project-planner`: the project-wide work graph query (with ready-to-start computation) and the
  Graph/Board planner page.

### Modified Capabilities
(none — `DependencyGraph.tsx` and `Dependency`'s existing model/queries are reused unchanged;
this only adds a new project-scoped query and a new page)

## Impact

- New `src/domain/dependency/queries.ts` addition: `getProjectWorkGraph`.
- New `src/app/projects/[id]/planner/page.tsx`.
- New `src/components/PlannerBoard.tsx` (status-lane board view).
- `src/app/page.tsx` (Dashboard project card): add a "Planner" link.
- `src/app/projects/[id]/settings/page.tsx`: add a "Planner" link.
- No schema changes — `WorkItem`/`Dependency` already carry everything needed.
