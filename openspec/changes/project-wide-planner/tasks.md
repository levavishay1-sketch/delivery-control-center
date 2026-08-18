## 1. Domain layer — project work graph query

- [x] 1.1 Add `getProjectWorkGraph(ctx, projectId)` to `src/domain/dependency/queries.ts`:
      `requireClientRole(ctx, project.clientId, ALL_ROLES)`, fetch every WorkItem in the project
      (id/title/type/status), fetch every `Dependency` where both `workItemId` and
      `dependsOnWorkItemId` are in that set, capped the same defensive way
      `getWorkItemDependencyGraph`'s `MAX_GRAPH_NODES` is (share the constant), and return
      `{ nodes, edges, truncated }` matching `DependencyGraph`'s existing prop shape.
- [x] 1.2 Add `readyToStart: boolean` to each returned node: `true` when the WorkItem's status is
      `OPEN` or `IN_PROGRESS` and every WorkItem it depends on (via outgoing `Dependency` edges)
      has status `COMPLETED` or `CLOSED`; `false` otherwise (including for WorkItems in any other
      status, where "ready to start" doesn't apply).
- [x] 1.3 Unit tests: a project's full node/edge set is returned regardless of pagination; an item
      with no upstream dependencies is `readyToStart`; an item depending on a non-`COMPLETED`/
      `CLOSED` item is not; an item not in `OPEN`/`IN_PROGRESS` status is never `readyToStart`
      even with satisfied dependencies; a read-only user can still view the graph; a user without
      any access to the project's client is refused. 9 tests, all passing.

## 2. UI — Planner page

- [x] 2.1 Create `src/app/projects/[id]/planner/page.tsx`: server component, calls
      `getProjectWorkGraph`, renders a Graph/Board view switcher (client-side toggle, no route
      change needed — a "use client" wrapper component holding the switch state).
- [x] 2.2 Graph view: render the existing `DependencyGraph` component with the project-wide
      `nodes`/`edges`/`truncated`, `focusNodeId=""` initially (per design.md decision 5), and each
      node visually marked when `readyToStart` (e.g. a small badge/ring, reusing `StatusBadge`
      tones already in the design system — decide the exact treatment during implementation,
      consistent with existing `DependencyGraph` node rendering). Implemented as an optional
      `readyIds?: Set<string>` prop on `DependencyGraph` (green ring + legend entry) — backward
      compatible, the single-item Dependencies tab call site is unaffected since it omits the prop.
- [x] 2.3 Create `src/components/PlannerBoard.tsx`: groups the passed nodes into lanes by
      `status`, rendering only lanes with at least one item; each card shows title/type/
      `readyToStart` indicator and links to `/work-items/[id]/360`; no drag-and-drop.
- [x] 2.4 Empty state ("No work items in this project yet") when the project has zero WorkItems.
      Handled in `PlannerView` (before the Graph/Board toggle renders) and again inside
      `PlannerBoard` for defense-in-depth.

## 3. Navigation

- [x] 3.1 Add a "Planner" link to the Dashboard's project card (`src/app/page.tsx`), alongside its
      existing "Constitution"/"Settings" links.
- [x] 3.2 Add a "Planner" link to `src/app/projects/[id]/settings/page.tsx`.

## 4. Tests

- [x] 4.1 Unit tests for `getProjectWorkGraph` (covered by Task 1.3 above — listed as its own
      group for tracking, per this project's convention of a dedicated Tests group).
- [ ] 4.2 E2E: open a project's Planner, verify the Graph view renders its WorkItems, switch to
      Board view, verify lanes group by status and a card links through to the item's 360° Record,
      verify a `readyToStart` item is visually distinguished from a blocked one —
      `e2e/project-wide-planner.spec.ts`.

## 5. Documentation & verification

- [x] 5.1 Update `docs/ROADMAP.md`'s Slice 16 entry: mark status, summarize what was built (mirror
      the Slice 14/15/18 status-block format), and note the deferred non-goals explicitly.
- [x] 5.2 Run build, lint, typecheck, unit tests, and this change's E2E spec; confirm the full
      existing suite has no new failures beyond the already-known pre-existing
      `slice5-engineering-evidence.spec.ts` and `slice6-configuration-center.spec.ts` failures
      (verify via the same temporary-checkout method used for Slices 15/18 if any new failure
      appears). Build, lint, typecheck all clean; 360/360 unit tests passing; new
      `e2e/project-wide-planner.spec.ts` passing. Full suite: 17 passed, 6 failed
      (`slice12-client-lifecycle.spec.ts`, `slice14-repository-discovery.spec.ts`,
      `slice4-connector-framework.spec.ts`, `slice5-engineering-evidence.spec.ts`,
      `slice6-configuration-center.spec.ts`, `slice8-i18n-rtl.spec.ts`). The last two are the
      known pre-existing baseline. The other four were verified via the same
      temporary-checkout method used for Slices 15/18: checked out the pre-Slice-16 commit
      (`224075a`), regenerated the Prisma client and Next.js route types, reran the four specs
      against the same accumulated local Postgres — all four failed identically there too (same
      "Add project" → unexpected navigation to `http://localhost:3000/?` symptom, or unrelated
      hydration-mismatch/timeout symptoms), confirming environmental flakiness from this
      session's many repeated E2E runs rather than a Slice 16 regression. Restored the working
      branch, regenerated Prisma client and route types, reran `tsc --noEmit` clean.
- [x] 5.3 Live verification: open a project with several WorkItems and at least one Dependency in
      the browser, confirm the Graph view matches the 360° Record's per-item graph data, switch to
      Board view and confirm lane grouping, and confirm a read-only user can view the Planner.
