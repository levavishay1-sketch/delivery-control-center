## 1. Domain query

- [x] 1.1 Add a `topLevelOpenWorkItems` field to `getClientDetail`'s return shape
      (`src/domain/client/queries.ts`): `db.workItem.findMany({ where: { parentId: null, status: {
      notIn: ["COMPLETED", "CLOSED"] }, project: { clientId } }, orderBy: { createdAt: "desc" },
      select: { id, title, type, status, projectId } })`, per design.md Decision 1/2. (Corrected
      `orderBy` from design.md's `updatedAt` to `createdAt` — `WorkItem` has no `updatedAt`
      column.)

## 2. UI

- [x] 2.1 Add a "Tasks" `Panel` to `src/app/clients/[id]/page.tsx`, positioned between the
      existing Requirements and Repositories panels (design.md Decision 3).
- [x] 2.2 Render each `topLevelOpenWorkItems` entry as a `Row`: title, type label, `StatusBadge`
      for status, linking to `/work-items/[id]/360` (design.md Decision 4). (Type label rendered
      as plain text — `{item.type} · {project name}` — mirroring the neighboring Requirements
      panel's exact row shape, rather than `workItemType.ts`'s icon-based treatment used elsewhere
      on the Dashboard/Planner, since every other row on this page is plain-text; a new
      `WORK_STATUS_TONE`/`WORK_STATUS_REASON` mapping was added since no `WorkStatus`→`StatusBadge`
      tone convention existed yet anywhere in the codebase.)
- [x] 2.3 Add the panel's empty state ("no top-level open work items") following this page's
      existing `PanelEmpty` pattern, per the design-system spec's "every list defines its four
      data states" requirement.

## 3. Tests

- [x] 3.1 Unit tests for the `topLevelOpenWorkItems` query
      (`src/domain/client/queries.test.ts`): a top-level open WorkItem appears; a child WorkItem
      (has a parent) is excluded even when its top-level parent appears; every WorkItemType
      (`PROJECT`/`TASK`/`BUG`/`CHANGE`) is included when top-level and open; a `COMPLETED`/`CLOSED`
      top-level WorkItem is excluded; scoping is correct across multiple projects under the same
      client and excludes another client's WorkItems. (Only `CLOSED` was exercised directly for
      the excluded-status case — both `COMPLETED` and `CLOSED` are excluded by the same
      `status: { notIn: [...] }` array-membership check, and reaching `COMPLETED` requires
      satisfying the unrelated evidence-driven completion policy from Slice 5.)

## 4. E2E test scenario

- [x] 4.1 Add `e2e/client-tasks-section.spec.ts`: on a client with a top-level Task, a top-level
      Bug, a top-level PROJECT-type WorkItem, a child WorkItem under that PROJECT-type WorkItem,
      and a CLOSED top-level WorkItem, verifies the Tasks section shows exactly the three
      eligible top-level open items and excludes the child and the closed item. (Used `CLOSED`
      rather than `COMPLETED` — same reasoning as unit test task 3.1. The project and WorkItem
      fixtures are seeded via a standalone `tsx` fixture script,
      `e2e/fixtures/seedClientTasksFixtures.ts` — through the real `createProject`/`createWorkItem`/
      `updateWorkItemStatus` domain commands, not raw DB inserts — rather than through the
      Dashboard's `AddProjectForm` UI. Diagnosed and confirmed a real, reproducible bug in that
      form unrelated to this slice: selecting a client from its dropdown that was created earlier
      in the same test run consistently causes the form's `name`/`key` local state to arrive empty
      on submit (confirmed via request-body interception — `clientId` correct, `name`/`key` ""),
      while the DOM's own input values read correctly right up to the click. This matches the
      session's already-documented, already-accepted QuickViewDrawer hydration-mismatch flakiness
      pattern (React discarding and asynchronously remounting a subtree, wiping local state) —
      out of scope to fix as part of this slice, so the fixture script sidesteps the interaction
      instead, matching the precedent `seedModelSnapshot.ts` (Slice 20) already set for a UI path
      Playwright can't reliably drive.)

## 5. Documentation & verification

- [ ] 5.1 Update `docs/ROADMAP.md`'s Slice 22 status block with the build summary, following the
      established pattern (what was built, deferred, and the full verification result).
- [ ] 5.2 Run build, lint, typecheck, the full unit test suite, and this change's E2E spec;
      confirm no regressions using the temporary-checkout diagnostic method against the pre-slice
      baseline commit if any new-looking E2E failure appears, per this session's established
      practice.
