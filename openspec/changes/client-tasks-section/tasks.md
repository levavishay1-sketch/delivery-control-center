## 1. Domain query

- [ ] 1.1 Add a `topLevelOpenWorkItems` field to `getClientDetail`'s return shape
      (`src/domain/client/queries.ts`): `db.workItem.findMany({ where: { parentId: null, status: {
      notIn: ["COMPLETED", "CLOSED"] }, project: { clientId } }, orderBy: { updatedAt: "desc" },
      select: { id, title, type, status, projectId } })`, per design.md Decision 1/2.

## 2. UI

- [ ] 2.1 Add a "Tasks" `Panel` to `src/app/clients/[id]/page.tsx`, positioned between the
      existing Requirements and Repositories panels (design.md Decision 3).
- [ ] 2.2 Render each `topLevelOpenWorkItems` entry as a `Row`: title, type label (reusing
      `src/lib/colors/workItemType.ts`'s existing type mapping), `StatusBadge` for status, linking
      to `/work-items/[id]/360` (design.md Decision 4).
- [ ] 2.3 Add the panel's empty state ("no top-level open work items") following this page's
      existing `PanelEmpty` pattern, per the design-system spec's "every list defines its four
      data states" requirement.

## 3. Tests

- [ ] 3.1 Unit tests for the `topLevelOpenWorkItems` query
      (`src/domain/client/queries.test.ts`): a top-level open WorkItem appears; a child WorkItem
      (has a parent) is excluded even when its top-level parent appears; every WorkItemType
      (`PROJECT`/`TASK`/`BUG`/`CHANGE`) is included when top-level and open; a `COMPLETED`/`CLOSED`
      top-level WorkItem is excluded; scoping is correct across multiple projects under the same
      client and excludes another client's WorkItems.

## 4. E2E test scenario

- [ ] 4.1 Add `e2e/client-tasks-section.spec.ts`: on a client with a top-level Task, a top-level
      Bug, a top-level PROJECT-type WorkItem, a child WorkItem under that PROJECT-type WorkItem,
      and a COMPLETED top-level WorkItem, verifies the Tasks section shows exactly the three
      eligible top-level open items and excludes the child and the completed item.

## 5. Documentation & verification

- [ ] 5.1 Update `docs/ROADMAP.md`'s Slice 22 status block with the build summary, following the
      established pattern (what was built, deferred, and the full verification result).
- [ ] 5.2 Run build, lint, typecheck, the full unit test suite, and this change's E2E spec;
      confirm no regressions using the temporary-checkout diagnostic method against the pre-slice
      baseline commit if any new-looking E2E failure appears, per this session's established
      practice.
