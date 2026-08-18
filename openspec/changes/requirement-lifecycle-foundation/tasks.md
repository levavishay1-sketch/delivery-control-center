## 1. Data model & migration

- [x] 1.1 Add `Requirement` model to `prisma/schema.prisma`: `id`, `clientId` (FK → `Client`,
      cascade), `type` (`WorkItemType`, default `TASK`), `title`, `description` (nullable),
      `status` (new `RequirementStatus` enum, default `OPEN`), `projectId` (nullable FK →
      `Project`, `onDelete: SetNull`), `workItemId` (nullable FK → `WorkItem`, `onDelete:
      SetNull`, set on SDD Activation), `createdByUserId` (FK → `User`), `createdAt`, `updatedAt`.
- [x] 1.2 Add `RequirementStatus` enum: `OPEN`, `SDD_ACTIVE`, `DECLINED`.
- [x] 1.3 Add the reverse relations (`Client.requirements`, `Project.requirements`,
      `WorkItem.requirement`) needed for the FKs above.
- [x] 1.4 Generate and run the migration; regenerate the Prisma client.

## 2. Domain layer — CRUD

- [x] 2.1 Create `src/domain/requirement/commands.ts`: `createRequirement` (client-scoped,
      `requireClientRole(ctx, clientId, WRITE_ROLES)`; validates an optional `projectId` belongs
      to the same client), `updateRequirement` (title/description/type; refuses when status is
      not `OPEN`), `declineRequirement` (OPEN → DECLINED; refuses when status is not `OPEN`).
- [x] 2.2 Create `src/domain/requirement/queries.ts`: `listRequirementsForClient`,
      `getRequirementById`.
- [x] 2.3 Zod input schemas for create/update, following the existing pattern in
      `src/domain/work-item/commands.ts`.
- [x] 2.4 Record an `AuditEvent` in the same transaction for create, update, decline, and (Group 3)
      SDD Activation — mirroring every other domain command's audit-write discipline.

## 3. Domain layer — SDD Activation

- [x] 3.1 Implement `startSddForRequirement(ctx, requirementId)` in
      `src/domain/requirement/commands.ts`: refuses if status is not `OPEN`; if `projectId` is
      null, calls `createProject` (name derived from the Requirement's title, key auto-generated
      and de-duplicated per client) and captures the new project; calls `createWorkItem` under the
      resolved project with `type` = the Requirement's type, `title`/`description` copied from the
      Requirement; sets the Requirement's `projectId` (if newly created) and `workItemId`, and
      moves `status` to `SDD_ACTIVE` in its own `db.$transaction` after `createProject`/
      `createWorkItem` (each already transactional) complete — composing them rather than nesting
      transactions, consistent with design.md decision 2/5.
- [ ] 3.2 Unit tests: standalone Requirement creates a new Project + WorkItem; Project-linked
      Requirement reuses the existing Project; re-activating an already-`SDD_ACTIVE` Requirement is
      refused with no side effects; a read-only user is refused.

## 4. API routes

- [x] 4.1 `POST /api/requirements` (create) and `GET /api/requirements?clientId=` (list) —
      `src/app/api/requirements/route.ts`.
- [x] 4.2 `GET /api/requirements/[id]` (detail) and `PATCH /api/requirements/[id]` (update) —
      `src/app/api/requirements/[id]/route.ts`.
- [x] 4.3 `POST /api/requirements/[id]/decline` — `src/app/api/requirements/[id]/decline/route.ts`.
- [x] 4.4 `POST /api/requirements/[id]/start-sdd` —
      `src/app/api/requirements/[id]/start-sdd/route.ts`.
- [x] 4.5 Each route follows the existing error-handling pattern (`src/app/api/repositories/[id]/discovery/route.ts`
      as the most recent precedent): domain errors mapped to their HTTP status, Zod validation
      errors to 400.

## 5. UI

- [x] 5.1 Requirements list section on the existing client detail page
      (`src/app/clients/[id]/page.tsx`), showing title/type/status/linked Project, using
      Panel/Row/StatusBadge design-system primitives.
- [x] 5.2 "New Requirement" form (`src/components/RequirementForm.tsx`, "use client"): type, title,
      description, and an optional Project picker restricted to the client's own projects; posts to
      `POST /api/requirements`, `router.refresh()` on success.
- [x] 5.3 Requirement detail page (`src/app/requirements/[id]/page.tsx`): status, linked Project
      (or "standalone"), and for a write-capable user viewing an `OPEN` Requirement, "Start SDD"
      (`src/components/StartSddButton.tsx`) and "Decline"
      (`src/components/DeclineRequirementButton.tsx`) actions; once `SDD_ACTIVE`, shows the linked
      WorkItem with a link into its existing detail view (which already surfaces
      `StartPipelineButton` when its Pipeline hasn't started).
- [x] 5.4 Use Slice 11's `InfoTooltip` next to the Project picker to explain the
      standalone-vs-linked distinction.
- [x] 5.5 Empty/permission-denied states for the list and detail pages (`PanelEmpty`, `notFound()`
      on a `ForbiddenError`), per CLAUDE.md's "Definition of Done." No dedicated loading state:
      both pages are server components with no client-side data fetch to show one for, matching
      the Repository detail page's own precedent.

## 6. Tests

- [x] 6.1 Unit tests for `commands.ts`/`queries.ts` (create standalone, create linked, update,
      decline, list, get, plus the Group 3 SDD Activation cases) —
      `src/domain/requirement/commands.test.ts`. 13 tests, all passing.
- [x] 6.2 E2E: create a standalone Requirement, start SDD, verify a Project + WorkItem now exist
      and the Requirement shows `SDD_ACTIVE` with a link to the WorkItem —
      `e2e/requirement-lifecycle.spec.ts`. Passing.

## 7. Documentation & verification

- [ ] 7.1 Update `docs/ROADMAP.md`'s Slice 15 entry: mark status, summarize what was built (mirror
      the Slice 14 status-block format), and note the deferred non-goals explicitly.
- [ ] 7.2 Run build, lint, typecheck, unit tests, and this change's E2E spec; confirm the full
      existing suite has no new failures (compare against the known pre-existing
      `slice5-engineering-evidence.spec.ts` failure, not a fresh regression).
- [ ] 7.3 Live verification: create a standalone Requirement and a Project-linked one in the
      browser, start SDD on each, confirm the resulting WorkItem appears where the 360°
      Record/Dashboard already expect it, and confirm a non-write-role user cannot create, edit, or
      activate a Requirement.
