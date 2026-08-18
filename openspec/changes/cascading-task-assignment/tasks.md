## 1. Data model & migration

- [x] 1.1 Add `Project.defaultExecutorType` (`ExecutorType`, default `UNASSIGNED`) and
      `Project.defaultExecutorId` (nullable FK to `User`) to `prisma/schema.prisma`.
- [x] 1.2 Add `WorkItem.assignmentSource` (`AssignmentSource` enum: `EXPLICIT` | `INHERITED`,
      default `INHERITED`) to `prisma/schema.prisma`.
- [x] 1.3 Write and run the migration; regenerate the Prisma client. Every existing WorkItem
      backfills to `assignmentSource=INHERITED` via the column default (design.md decision 5) — no
      separate backfill script needed since no existing Project has a default executor set yet.

## 2. Domain layer — assignment on WorkItem creation/update

- [x] 2.1 `createWorkItem` (`src/domain/work-item/commands.ts`): when no explicit `executorType`/
      `executorId` is given, look up the Project's default executor and use it, setting
      `assignmentSource=INHERITED`; when an explicit executor is given, set
      `assignmentSource=EXPLICIT`.
- [x] 2.2 `updateWorkItem`: when `executorType`/`executorId` is included in the update, set
      `assignmentSource=EXPLICIT` (design.md decision 3 — a direct edit always marks it explicit,
      symmetric with how a cascade marks it inherited).

## 3. Domain layer — cascade preview & apply

- [x] 3.1 `previewAssignmentCascade(ctx, projectId, newExecutor)` in
      `src/domain/project/commands.ts`: read access check, returns the WorkItems currently
      `INHERITED`/`UNASSIGNED` (would be reassigned automatically) and those currently `EXPLICIT`
      (would only be reassigned under `REASSIGN_ALL`) — id/title/current executor for each, no
      writes. (Uses `assignmentSource` alone to split the sets — a `UNASSIGNED` executor with no
      explicit choice behind it is always `INHERITED` per design.md decision 4, so a separate
      `executorType==="UNASSIGNED"` check would be redundant and, worse, would wrongly pull an
      explicitly-set-to-unassigned `EXPLICIT` item into the auto-cascaded set.)
- [x] 3.2 `applyAssignmentCascade(ctx, projectId, newExecutor, option)` — `option` is a required
      `"INHERITED_ONLY" | "REASSIGN_ALL"` Zod enum, no default. In one transaction: updates the
      Project's `defaultExecutorType`/`defaultExecutorId`; under `INHERITED_ONLY`, reassigns every
      `INHERITED`/`UNASSIGNED` WorkItem to the new executor (staying `INHERITED`); under
      `REASSIGN_ALL`, also reassigns every `EXPLICIT` WorkItem (becoming `INHERITED` — design.md
      decision 3).
- [x] 3.3 Audit events: one for the Project default-executor change (naming the chosen option),
      one per cascaded WorkItem reassignment (old executor, new executor, and that it resulted
      from a Project-level cascade) — all in the same transaction as the writes they describe.
- [x] 3.4 Access control: `requireClientRole(ctx, project.clientId, WRITE_ROLES)` on both preview
      and apply — read-only users can't trigger or even preview a cascade they can't apply.

## 4. UI — Project Settings

- [x] 4.1 A new "Default Executor" section on `src/app/projects/[id]/settings/page.tsx`: shows the
      Project's current default executor, a control to propose a new one.
- [x] 4.2 Preview step: on proposing a new default, calls `previewAssignmentCascade` and shows the
      affected (`INHERITED`/`UNASSIGNED`) and unaffected (`EXPLICIT`) WorkItem lists.
- [x] 4.3 Confirm step: two explicit buttons ("Apply to unassigned only" / "Reassign everyone"),
      neither visually pre-selected/default-styled; clicking one calls `applyAssignmentCascade`
      with that option and refreshes.

## 5. Tests

- [x] 5.1 Unit tests: new WorkItem with no executor inherits the Project default
      (`assignmentSource=INHERITED`); new WorkItem with an explicit executor is not overridden
      (`assignmentSource=EXPLICIT`); Project with no default leaves new WorkItems `UNASSIGNED`
      (today's behavior, unchanged); `updateWorkItem` setting an executor flips
      `assignmentSource=EXPLICIT`; `previewAssignmentCascade` correctly splits affected/unaffected
      WorkItems; `applyAssignmentCascade` under `INHERITED_ONLY` only touches `INHERITED`/
      `UNASSIGNED` items; under `REASSIGN_ALL` touches every item and flips previously-`EXPLICIT`
      ones to `INHERITED`; a read-only user is refused on both preview and apply; audit events are
      recorded for the Project change and each cascaded WorkItem.
- [x] 5.2 E2E: create a Project, create one WorkItem with an explicit executor and one without,
      set a Project default executor, preview the cascade, confirm "apply to unassigned only",
      verify only the unassigned item moved; change the default again, confirm "reassign
      everyone", verify the previously-explicit item now also shows the new executor —
      `e2e/cascading-task-assignment.spec.ts`. Found and fixed a real bug while writing this: the
      test's own premature `page.goto()` right after clicking a cascade-confirm button raced the
      in-flight POST and aborted it server-side (`SyntaxError: Unexpected end of JSON input` in
      `default-executor/route.ts`'s `request.json()`) — not a Slice 19 domain bug, a test-timing
      bug; fixed by waiting for the form to reset to its pre-preview state (which only happens
      after the POST resolves) before navigating away. Also avoided repeatedly opening/closing
      the Quick View drawer (a known pre-existing hydration-mismatch flake trigger, same symptom
      documented in the Slice 16 status block) by capturing each item's 360° Record URL once and
      reusing direct navigation. Passing, stable across 2 consecutive runs.

## 6. Documentation & verification

- [ ] 6.1 Update `docs/ROADMAP.md`'s Slice 19 entry: mark status, summarize what was built (mirror
      the Slice 16/18 status-block format), and note the deferred non-goals explicitly (ownerId,
      Decision Ownership, other entity types, Configuration Center generalization).
- [ ] 6.2 Run build, lint, typecheck, unit tests, and this change's E2E spec; confirm the full
      existing suite has no new failures beyond the already-known pre-existing baseline (verify
      via the temporary-checkout method used for prior slices if any new failure appears).
- [ ] 6.3 Live verification: open a project with a mix of explicit and unassigned WorkItems in the
      browser, set a default executor, preview and confirm both cascade options, confirm the
      resulting executor assignments and audit trail entries match.
