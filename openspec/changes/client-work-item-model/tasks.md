## 1. Schema & migration

- [ ] 1.1 Add `Connection` model (`id`, `clientId` → `Client` cascade, `source String`, `name
      String`, `createdAt`, `updatedAt`) per design.md Decision 6.
- [ ] 1.2 Add `WorkItemRepository` join model (`workItemId` → `WorkItem` cascade, `repositoryId` →
      `Repository` cascade, `@@unique([workItemId, repositoryId])`) per design.md Decision 7.
- [ ] 1.3 Add `WorkItemAttachment` model (`id`, `workItemId` → `WorkItem` cascade, `filename
      String`, `mimeType String`, `size Int`, `data Bytes`, `createdAt`) per design.md Decision 4.
- [ ] 1.4 `Repository`: add `source String?`, `url String?`; make `connectorId` optional
      (`String?`, keep `@unique`); make `owner`, `name`, `externalId` optional (`String?`) — per
      design.md Decision 5. Update every existing `db.repository.create` test fixture call site
      that relies on these being required (`evidence/linking.test.ts`,
      `repository-discovery/commands.test.ts`, `evidence/events.test.ts`, `agent/budget.test.ts`)
      only if the Prisma type change breaks them; the values themselves don't need to change.
- [ ] 1.5 Drop the `Requirement` model and `RequirementStatus` enum entirely (design.md's
      Migration note — no data to preserve). Remove `Client.requirements`/`Project.requirements`/
      `WorkItem.requirement` back-relations.
- [ ] 1.6 Run `npx prisma migrate dev --name client_work_item_model` and `npx prisma generate`;
      confirm the generated client at `@/generated/prisma/client` reflects all of the above.

## 2. Domain layer: retire Requirement, extend WorkItem

- [ ] 2.1 Delete `src/domain/requirement/` (`commands.ts`, `queries.ts`, and their `.test.ts`
      files). Move `generateProjectKey` (currently private in `requirement/commands.ts`) to
      `src/domain/project/commands.ts` as an exported helper — it's reused by the new
      Client-facing WorkItem creation path.
- [ ] 2.2 `src/domain/work-item/commands.ts`: add `createWorkItemForClient(ctx, { clientId, type,
      title, description?, source?, parentId?, repositoryIds? })` — per design.md Decision 2:
      resolves `projectId` from `parentId`'s existing project if given, else creates a new Project
      via `generateProjectKey`+`createProject`; then calls the existing `createWorkItem` with the
      resolved `projectId`. Expose `source` (defaulting to `MANUAL`) per Decision 3.
- [ ] 2.3 Add `associateWorkItemRepositories(ctx, workItemId, repositoryIds)`: verifies every
      `repositoryId` belongs to the same client as the work item's project (design.md Decision 7 /
      work-item-model's same-client requirement), throws `ValidationError` naming the mismatched
      repository otherwise, then upserts `WorkItemRepository` rows (removing any no longer
      selected).
- [ ] 2.4 Add `addWorkItemAttachment(ctx, workItemId, { filename, mimeType, size, data })` and
      `listWorkItemAttachments(ctx, workItemId)` to `src/domain/work-item/commands.ts` /
      `queries.ts`.
- [ ] 2.5 Unit tests (`src/domain/work-item/commands.test.ts`): creating with only type+title
      auto-creates a Project; creating with a parent reuses the parent's project; source defaults
      to MANUAL and is settable; associating a same-client repository succeeds; associating a
      different client's repository is rejected; deleting an associated repository leaves the work
      item intact.

## 3. Domain layer: direct Repository creation, edit, delete

- [ ] 3.1 Add `src/domain/repository/commands.ts` with `createRepositoryForClient(ctx, { clientId,
      source, url })`, `updateRepository(ctx, id, { source?, url? })`, and `deleteRepository(ctx,
      id)` — deletion relies on the existing `onDelete: Cascade` on `ProjectRepository` and the new
      `WorkItemRepository` to remove associations while leaving `WorkItem`/`Project` rows intact
      (design.md Decision 5, `repository-management` spec).
- [ ] 3.2 Add `src/domain/repository/queries.ts` `listRepositoriesForClient` if not already
      covered by `getClientDetail`'s existing `repositories` field (reuse, don't duplicate).
- [ ] 3.3 Unit tests: creating with only source+url succeeds with no connectorId; editing
      source/url persists; deleting a repository removes its `ProjectRepository`/
      `WorkItemRepository` rows but not the underlying Work Items/Projects; a read-only user is
      refused on all three commands.

## 4. Domain layer: Connection CRUD

- [ ] 4.1 Add `src/domain/connection/commands.ts`: `createConnection(ctx, { clientId, source,
      name })`, `updateConnection(ctx, id, { source?, name? })`, `deleteConnection(ctx, id)` — all
      `WRITE_ROLES`-gated via `requireClientRole`, matching every other client-owned command's
      pattern.
- [ ] 4.2 Add `src/domain/connection/queries.ts`: `listConnectionsForClient(ctx, clientId)`,
      `getConnectionById(ctx, id)`.
- [ ] 4.3 Unit tests mirroring the `Requirement`/`Repository` command test shape: create/edit/
      delete succeed for write-capable users and are refused for read-only users.

## 5. API routes

- [ ] 5.1 Remove `/api/requirements/*` route files.
- [ ] 5.2 Add `/api/work-items/route.ts` `POST` support for the new client-facing shape (or a new
      `/api/clients/[id]/work-items/route.ts` — match whichever existing route convention this
      project already uses for client-scoped creation; `POST /api/clients` is the precedent for
      client-scoped creates elsewhere).
- [ ] 5.3 Add `/api/work-items/[id]/attachments/route.ts` (`POST` upload, `GET` list).
- [ ] 5.4 Add `/api/work-items/[id]/repositories/route.ts` (`PUT`/`POST` to set associated
      repositories).
- [ ] 5.5 Add `/api/clients/[id]/repositories/route.ts` (`POST` create) and
      `/api/repositories/[id]/route.ts` (`PATCH` update, `DELETE`).
- [ ] 5.6 Add `/api/clients/[id]/connections/route.ts` (`POST` create) and
      `/api/connections/[id]/route.ts` (`GET`/`PATCH`/`DELETE`).

## 6. UI: Client page restructure

- [ ] 6.1 `src/app/clients/[id]/page.tsx`: header shows `client.name` + `client.slug`. Remove the
      "Projects," "Requirements," and "Connectors" panels. Add "WORK ITEMS" (all top-level work
      items regardless of status, per clients-hub delta), "REPOSITORIES," and "CONNECTIONS"
      panels, each with an "Add …" button linking to its dedicated creation route (no inline
      forms) and each row linking to its detail screen.
- [ ] 6.2 `src/domain/client/queries.ts`'s `getClientDetail`: drop the `notIn:
      ["COMPLETED","CLOSED"]` status filter on `topLevelOpenWorkItems` (rename to
      `topLevelWorkItems`) per the clients-hub delta's "all statuses" requirement; add
      `connections: db.connection.findMany({ where: { clientId } })` alongside the existing
      `projects`/`repositories` queries (`connectors` query removed from this return shape, or
      kept internally unused — confirm no other caller depends on it before removing).

## 7. UI: dedicated creation screens

- [ ] 7.1 New page `src/app/clients/[id]/work-items/new/page.tsx` + a client component form:
      Type (required, PROJECT/TASK/BUG/CHANGE), Title (required), Source (optional select from
      `IntegrationType`), Parent (optional select from the client's existing work items),
      Characterization text (optional textarea), Attachments (optional file input), Related
      Repositories (optional multi-select scoped to the client's own repositories only).
- [ ] 7.2 New page `src/app/clients/[id]/repositories/new/page.tsx` + form: Source (required),
      Link (required).
- [ ] 7.3 New page `src/app/clients/[id]/connections/new/page.tsx` + form: Source (required), Name
      (required).

## 8. UI: detail screens

- [ ] 8.1 `src/app/work-items/[id]/360/page.tsx`: add a Characterization section (description text
      + attachment list/upload) and a Related Repositories section (scoped to the item's own
      client), if not already reasonably close to this shape — reuse existing 360 page structure.
- [ ] 8.2 `src/app/repositories/[id]/page.tsx`: add an editable Source/Link panel and a "Delete
      Repository" action with a confirmation dialog naming that associations are removed but Work
      Items are not deleted.
- [ ] 8.3 New page `src/app/connections/[id]/page.tsx`: view/edit Source+Name, "Delete Connection"
      with confirmation.
- [ ] 8.4 Delete `src/app/requirements/` route, `RequirementForm.tsx`, `StartSddButton.tsx`,
      `DeclineRequirementButton.tsx`.

## 9. E2E test scenario

- [ ] 9.1 Add `e2e/client-work-item-model.spec.ts`: create a client, add a Work Item via the
      dedicated creation screen with only Type+Title (verify it appears in WORK ITEMS with an
      auto-created Project underneath), add a second Work Item as a child of the first (verify it
      does NOT appear top-level), add a Repository via Source+Link (verify it appears in
      REPOSITORIES and is selectable as a Related Repository on a new Work Item), add a Connection
      via Source+Name (verify it appears in CONNECTIONS and is never offered on the Work Item
      form), delete the Repository (verify the Work Item it was related to still exists).

## 10. Documentation & verification

- [ ] 10.1 Update `docs/ROADMAP.md`'s new slice entry with the build summary.
- [ ] 10.2 Run build, lint, typecheck, the full unit test suite, and this change's E2E spec;
      confirm no regressions against the established baseline.
