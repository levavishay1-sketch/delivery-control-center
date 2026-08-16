## 1. Data model & migration

- [ ] 1.1 Add `Repository.clientId` (nullable initially), a `ProjectRepository` join table
      (`projectId`, `repositoryId`, unique on the pair), and `Client.active Boolean @default(true)`
      to `prisma/schema.prisma`. Generate the migration.
- [ ] 1.2 Write and run the backfill migration/script: set `Repository.clientId` for every
      existing row via `connectorId → connector.projectId → project.clientId`.
- [ ] 1.3 Follow-up migration making `Repository.clientId` `NOT NULL` now that every row has one.

## 2. Domain layer: Client CRUD

- [ ] 2.1 Add `updateClient(ctx, id, { name, slug })` to `src/domain/client/commands.ts` —
      `requireOrgAdmin`, mirrors `createProject`'s single-transaction pattern where relevant.
- [ ] 2.2 Add `deactivateClient(ctx, id)` — `requireOrgAdmin`, sets `active: false`. Does not
      touch any related row.
- [ ] 2.3 Add `reactivateClient(ctx, id)` — `requireOrgAdmin`, sets `active: true`. Symmetric with
      2.2, per the spec's Create/Edit/Deactivate/Reactivate lifecycle.
- [ ] 2.4 Add `listActiveClients(ctx)` (or extend `listClients` with an `activeOnly` option) for
      Dashboard/Attention Center call sites, reusing `listClients`'s existing access-scoping
      logic rather than duplicating it.
- [ ] 2.5 Add `getClientDetail(ctx, id)` returning the client plus its projects, its repositories
      (via the new `clientId`, across all projects), and its connectors — for the Clients hub
      detail page.

## 3. Domain layer: repository find-or-create by client

- [ ] 3.1 Update `linkRepository` in `src/domain/evidence/commands.ts`: after fetching the
      repository via the project's GitHub connector, look up an existing `Repository` by
      `(clientId, owner, name)` instead of by `connectorId`. If found, reuse it; if not, create it
      with the project's `clientId`. Either way, create the `ProjectRepository` link row (unique
      violation = already linked, treat as the existing "already has a linked repository" error
      for *this* project specifically, not client-wide).
- [ ] 3.2 Update any other code reading `Repository` scoped by `connectorId`/project (e.g. the
      360° Record's Code & Changes tab query) to resolve via `ProjectRepository` for the current
      project instead of assuming a 1:1.

## 4. API routes

- [ ] 4.1 `POST /api/clients` using `createClient`, mirroring `POST /api/projects`'s pattern
      (typed body, 400 on missing fields, `DomainError` → status mapping).
- [ ] 4.2 `PATCH /api/clients/[id]` using `updateClient`.
- [ ] 4.3 `POST /api/clients/[id]/deactivate` using `deactivateClient` and
      `POST /api/clients/[id]/reactivate` using `reactivateClient`.

## 5. UI: Client CRUD forms

- [ ] 5.1 New Client form (name, slug), reachable from the Clients hub, using the `FormField`/
      `Button` primitives (Slice 10) — mirrors `AddProjectForm`'s shape.
- [ ] 5.2 Edit Client form (name, slug) on the client detail page.
- [ ] 5.3 Deactivate/Reactivate action on the client detail page (whichever applies to the
      client's current state), with an `InfoTooltip` (Slice 11) explaining what deactivation does
      and does not do (data is preserved, not deleted, and it can be reactivated later).

## 6. UI: Clients hub

- [ ] 6.1 New `/clients` list page: every client the user can access, each showing name, project
      count, and active/inactive state (dimmed/badged, per design-system status conventions).
- [ ] 6.2 New `/clients/[id]` detail page: the client's projects, its repositories (across all
      projects), and its connectors, using `Panel`/`Row`.
- [ ] 6.3 Add a "Clients" nav entry to `NavRail`, positioned per the existing IA (near Dashboard/
      Attention Center).

## 7. Dashboard & Attention Center integration

- [ ] 7.1 Dashboard's client/project listing excludes deactivated clients (use
      `listActiveClients`/the `activeOnly` option from Task 2.4).
- [ ] 7.2 `getItemsNeedingAttention` excludes work under deactivated clients.

## 8. Tests

- [ ] 8.1 Unit tests for `updateClient`/`deactivateClient`/`reactivateClient`/`listActiveClients`
      (org-admin gating, active-flag behavior) — follow `src/domain/client/commands.test.ts`'s
      existing pattern if one exists, else the sibling domain modules' pattern.
- [ ] 8.2 Unit tests for `linkRepository`'s changed find-or-create-by-client behavior: first link
      creates a `Repository`; a second project under the same client linking the same GitHub repo
      reuses it and only creates a new `ProjectRepository` row; linking the same repository twice
      for the *same* project is still rejected.
- [ ] 8.3 E2E: create a client, edit it, deactivate it, confirm it disappears from
      Dashboard/Attention Center but remains visible (marked inactive) in the Clients hub and its
      own detail page, then reactivate it and confirm it reappears on the Dashboard.
- [ ] 8.4 E2E: link a GitHub repository to one project, then link the *same* repository to a
      second project under the same client (via a second GitHub connector pointed at the same
      repo, or the stub-server pattern used in `e2e/slice5-engineering-evidence.spec.ts`); confirm
      the Clients hub's detail view shows one repository linked to both projects, not two.

## 9. Documentation & verification

- [ ] 9.1 Run `/verify` (build + lint + a live check): create/edit/deactivate/reactivate a client
      live, confirm the Clients hub and detail page render correctly, confirm a deactivated
      client's projects vanish from Dashboard/Attention Center, spot-check RTL on the new pages.
- [ ] 9.2 Update `docs/ROADMAP.md`'s Slice 12 row and detail section to **Done**, linking this
      change's archive path.
