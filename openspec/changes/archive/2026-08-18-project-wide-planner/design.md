## Context

See proposal.md - Why / Roadmap Source for motivation and sourcing.

Relevant existing shape, verified in code:
- `DependencyGraph.tsx` takes generic `{ nodes, edges, focusNodeId, truncated }` props and is
  already invoked exactly this way from `DependenciesTab.tsx:110`:
  `<DependencyGraph nodes={graph.nodes} edges={graph.edges} focusNodeId={workItemId}
  truncated={graph.truncated} />`. Its `focusNodeId` prop seeds `selectedId` state (line 34) used
  only for BFS highlighting (`bfs(selectedId, ...)`, lines 41-49) — an id with no graph presence
  simply produces empty upstream/downstream sets (no crash), so a project view with no natural
  single "focus" item can safely pass an empty string as the initial `focusNodeId`.
- `getWorkItemDependencyGraph` (`dependency/queries.ts:43-76`) already establishes the BFS-with-cap
  pattern (`MAX_GRAPH_NODES = 200`) and returns exactly the `{ nodes, edges, truncated }` shape
  `DependencyGraph` expects — `getProjectWorkGraph` mirrors its return shape, just sourced by
  `projectId` instead of a BFS walk from one node.
- `WorkStatus` (9 values) and `WorkItemType` are both already-stable enums; no new enum needed for
  board columns.

## Goals / Non-Goals

**Goals:**
- Give a project a whole-work Graph view and a status-lane Board view, switchable, both read-only/
  navigational.
- Reuse `DependencyGraph.tsx` and the existing BFS-with-cap query pattern verbatim.

**Non-Goals** (in addition to proposal.md's non-goals list):
- Drag-and-drop status editing on the Board. `updateWorkItemStatus`'s `assertValidTransition` gate
  stays the only path to change a WorkItem's status; the Board is navigation only.
- Critical-path computation. `getCriticalPath` (`dependency/queries.ts:29-32`) has been a
  documented empty-array stub since Slice 2 and stays that way — out of scope here.
- Hierarchy/`parentId` edges in the graph. Stays `Dependency`-only, matching
  `DependencyGraph.tsx`'s existing scope and the gap-analysis's own note that Hierarchy vs.
  Dependency separation is already correct in this codebase and shouldn't be conflated.

## Decisions

**1. `getProjectWorkGraph` lives in `src/domain/dependency/queries.ts`, not a new module.**
It returns the exact same `{ nodes, edges, truncated }` shape `getWorkItemDependencyGraph` already
does, differing only in how nodes are selected (by `projectId` membership, not BFS reachability
from one node) — keeping it alongside its sibling avoids splitting one concept (the project's
dependency data) across two domain modules for no behavioral reason.

**2. Capped the same way `getWorkItemDependencyGraph` is (`MAX_GRAPH_NODES`), not uncapped.**
A project could in principle have more WorkItems than is sane to lay out in one SVG at once.
Reusing the same defensive cap and `truncated` flag `DependencyGraph.tsx` already knows how to
display (see its existing "Graph truncated" warning, `DependencyGraph.tsx:110`) means the UI needs
zero new truncation-handling code.

**3. `readyToStart` is computed at query time, not stored.**
It's a pure function of two already-stored facts (a WorkItem's own status, and its upstream
dependencies' statuses) that can change independently of any write this slice makes — computing it
on read avoids a second write path that could drift out of sync with the underlying data.

**4. Board view groups by `WorkStatus` value, showing only lanes that have items.**
Showing all 9 possible lanes unconditionally on every project (including ones with zero items in
several statuses) would make small projects mostly empty lanes; showing only populated lanes keeps
the board legible without losing any information — a lane with zero items conveys nothing a user
needs decided at a glance.

**5. `DependencyGraph.tsx`'s `focusNodeId` prop receives `""` (no selection) at the Planner's
initial render, not a duplicated first item.**
Verified safe: `bfs("", adjacencyMap)` returns an empty set since `""` never appears as a key,
so `nodeColor`/`nodeOpacity` treat every node as neither selected nor upstream/downstream —
all render at full opacity, matching the intended "show everything until the user picks a focus"
initial state, achieved without a code change to `DependencyGraph.tsx` itself.

## Risks / Trade-offs

- [Risk] A project with a genuinely large WorkItem count could still be visually cluttered even
  under the node cap. → Mitigation: the Board view is the practical fallback for large projects
  (grouped, scannable list vs. a dense graph); the Graph view's existing focus mode still lets a
  user narrow to one item's neighborhood even at project scope.
- [Risk] `readyToStart`'s definition (every upstream dependency `COMPLETED`/`CLOSED`) is a
  simplification — it doesn't account for a Blocker on the item itself, which is a separate
  concept (`Blocker` model) this slice doesn't query. → Mitigation: labeled precisely as
  dependency-based readiness in the UI copy, not overall "unblocked" status, so it isn't read as a
  broader guarantee than it is.

## Migration Plan

None — no schema change. Purely additive query + new page + two new nav links.
