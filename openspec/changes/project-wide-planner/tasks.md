## 1. Domain layer — project work graph query

- [ ] 1.1 Add `getProjectWorkGraph(ctx, projectId)` to `src/domain/dependency/queries.ts`:
      `requireClientRole(ctx, project.clientId, ALL_ROLES)`, fetch every WorkItem in the project
      (id/title/type/status), fetch every `Dependency` where both `workItemId` and
      `dependsOnWorkItemId` are in that set, capped the same defensive way
      `getWorkItemDependencyGraph`'s `MAX_GRAPH_NODES` is (share the constant), and return
      `{ nodes, edges, truncated }` matching `DependencyGraph`'s existing prop shape.
- [ ] 1.2 Add `readyToStart: boolean` to each returned node: `true` when the WorkItem's status is
      `OPEN` or `IN_PROGRESS` and every WorkItem it depends on (via outgoing `Dependency` edges)
      has status `COMPLETED` or `CLOSED`; `false` otherwise (including for WorkItems in any other
      status, where "ready to start" doesn't apply).
- [ ] 1.3 Unit tests: a project's full node/edge set is returned regardless of pagination; an item
      with no upstream dependencies is `readyToStart`; an item depending on a non-`COMPLETED`/
      `CLOSED` item is not; an item not in `OPEN`/`IN_PROGRESS` status is never `readyToStart`
      even with satisfied dependencies; a read-only user can still view the graph; a user without
      any access to the project's client is refused.

## 2. UI — Planner page

- [ ] 2.1 Create `src/app/projects/[id]/planner/page.tsx`: server component, calls
      `getProjectWorkGraph`, renders a Graph/Board view switcher (client-side toggle, no route
      change needed — a "use client" wrapper component holding the switch state).
- [ ] 2.2 Graph view: render the existing `DependencyGraph` component with the project-wide
      `nodes`/`edges`/`truncated`, `focusNodeId=""` initially (per design.md decision 5), and each
      node visually marked when `readyToStart` (e.g. a small badge/ring, reusing `StatusBadge`
      tones already in the design system — decide the exact treatment during implementation,
      consistent with existing `DependencyGraph` node rendering).
- [ ] 2.3 Create `src/components/PlannerBoard.tsx`: groups the passed nodes into lanes by
      `status`, rendering only lanes with at least one item; each card shows title/type/
      `readyToStart` indicator and links to `/work-items/[id]/360`; no drag-and-drop.
- [ ] 2.4 Empty state ("No work items in this project yet") when the project has zero WorkItems.

## 3. Navigation

- [ ] 3.1 Add a "Planner" link to the Dashboard's project card (`src/app/page.tsx`), alongside its
      existing "Constitution"/"Settings" links.
- [ ] 3.2 Add a "Planner" link to `src/app/projects/[id]/settings/page.tsx`.

## 4. Tests

- [ ] 4.1 Unit tests for `getProjectWorkGraph` (covered by Task 1.3 above — listed as its own
      group for tracking, per this project's convention of a dedicated Tests group).
- [ ] 4.2 E2E: open a project's Planner, verify the Graph view renders its WorkItems, switch to
      Board view, verify lanes group by status and a card links through to the item's 360° Record,
      verify a `readyToStart` item is visually distinguished from a blocked one —
      `e2e/project-wide-planner.spec.ts`.

## 5. Documentation & verification

- [ ] 5.1 Update `docs/ROADMAP.md`'s Slice 16 entry: mark status, summarize what was built (mirror
      the Slice 14/15/18 status-block format), and note the deferred non-goals explicitly.
- [ ] 5.2 Run build, lint, typecheck, unit tests, and this change's E2E spec; confirm the full
      existing suite has no new failures beyond the already-known pre-existing
      `slice5-engineering-evidence.spec.ts` and `slice6-configuration-center.spec.ts` failures
      (verify via the same temporary-checkout method used for Slices 15/18 if any new failure
      appears).
- [ ] 5.3 Live verification: open a project with several WorkItems and at least one Dependency in
      the browser, confirm the Graph view matches the 360° Record's per-item graph data, switch to
      Board view and confirm lane grouping, and confirm a read-only user can view the Planner.
