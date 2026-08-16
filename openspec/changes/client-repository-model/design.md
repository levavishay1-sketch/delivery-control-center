## Context

Today's chain is rigid: `Repository.connectorId` is `@unique`, `Connector.projectId` is
`@unique`. `linkRepository(ctx, projectId)` in `src/domain/evidence/commands.ts` is the *only*
place a `Repository` row is created — it requires the project's `GITHUB` connector to already
exist, fetches that connector's repository via its decrypted config, and today explicitly asserts
"one Repository per Connector" (throws if `db.repository.findUnique({ where: { connectorId } })`
already returns a row).

`createClient()` exists in `src/domain/client/commands.ts`, org-admin gated via
`requireOrgAdmin`, but has no route. `listClients(ctx)`/`getClientById(ctx, id)` in
`src/domain/client/queries.ts` already implement the correct access-scoping (all clients for an
org admin, else only clients the user has a membership on) — reused as-is, not reinvented.
`createProject`'s pattern (`src/domain/project/commands.ts`) — one `requireClientRole`/
`requireOrgAdmin` check, one `db.$transaction`, one `POST` route with a typed body and 400 on
missing fields — is the template for the new Client mutation commands and routes.

See proposal.md for motivation and the explicit scope boundary (this slice does not build a
client-level, project-independent repository *connection* flow — that's Slice 13's job).

## Goals / Non-Goals

**Goals:**
- A `Repository` is queryable and reusable at the client level once it exists, regardless of
  which project's connector originally created it.
- Real, org-admin-gated Client CRUD (create, edit name/slug, deactivate) — reachable via routes
  and UI, not just a domain function.
- A Clients hub (list + detail) reusing Slice 10's design-system primitives.

**Non-Goals:**
- A repository connectable with zero projects/connectors involved (Slice 13/14's job — this slice
  keeps repository *creation* flowing through `linkRepository`'s existing project+connector path;
  it changes what that path does once a repository already exists for the client, not how a
  repository comes into being in the first place).
- Hard-deleting a client or any of its data — deactivation only, per the roadmap blueprint's own
  language ("without deleting its historical data").
- Any change to `AI budget`, `SDD pipeline`, `Evidence enforcement`, or connector sync mechanics
  beyond the repository-linking behavior named in the modified capability.

## Decisions

**`Repository.clientId` is a required, backfilled FK — `connectorId` stays.** Adding `clientId`
alongside the existing `connectorId` (rather than replacing it) keeps every existing sync/webhook
code path (`src/domain/connector/sync.ts`, webhook intake, catch-up fetch) working unchanged —
they all key off `connectorId`/`repositoryId`, never `clientId`. The backfill migration derives
`clientId` for every existing row via `connectorId → connector.projectId → project.clientId` (a
single SQL `UPDATE ... FROM` join, run as a data migration alongside the schema migration).

**`ProjectRepository` is the join, not a second FK on `Repository`.** A repository can end up
linked to more than one project (once `linkRepository` reuses instead of duplicating), so the
relationship is genuinely many-to-many — a single nullable second `projectId` on `Repository`
couldn't represent "linked to three projects." Composite unique on
`(projectId, repositoryId)`; `linkRepository`'s first call for a given project creates this row,
not a `Repository` row, once a matching repository already exists for the client.

**`linkRepository` becomes find-or-create by `(clientId, owner, name)`, not
find-by-`connectorId`.** The uniqueness check moves from "does this connector already have a
repository" to "does this client already have a repository matching the fetched
`owner`/`name`" — matching GitHub's own identity for a repo. If found, reuse it and create the
`ProjectRepository` link; if not, create both the `Repository` (with the new `clientId`) and the
link, in the same transaction as today.

**`Client.active` is a plain `Boolean @default(true)`, not a nullable `deactivatedAt`.** A single
boolean is sufficient for every scenario in the spec delta (hide from active-work surfaces, show
distinguished in the hub, and — since deactivate/reactivate are both part of the Client lifecycle
per the spec — flip cleanly in either direction) and matches this project's existing convention of
small, precise fields over inferring status from a timestamp's nullability (e.g. `WorkStatus` is
its own enum, not inferred). If a future slice needs "when was it deactivated," that's an additive
audit-event concern, not a reason to complicate this field now. Deactivate and reactivate are two
symmetric commands over the same field (`active: false` / `active: true`), not a one-way door.

**Deactivation filters Dashboard/Attention, not `listClients`/`getClientById`.** Those two
existing queries are reused as-is for the Clients hub (which must show inactive clients,
distinguished). A new, narrower `listActiveClients(ctx)` (or an `active: true` filter added at
the Dashboard/Attention call sites) is what actually implements "excluded from active-work
surfaces" — keeping the access-scoping logic in one place rather than duplicating it with a
filter bolted on differently in two call sites.

**Clients hub as new pages under `/clients`, not folded into the existing Dashboard.** Mirrors
the existing `/attention`, `/audit` pattern (top-level route, its own `page.tsx`) rather than a
tab or a modal — consistent with how every other major surface in this product is a real route,
and matches the mock's own IA (`Clients` as its own nav item).

## Risks / Trade-offs

- **Backfill correctness** for `Repository.clientId`: every existing repository row must resolve
  a client via its connector's project. → Mitigation: the migration's `UPDATE ... FROM` join
  covers every row by construction (every `Repository` today has a `connectorId`, every
  `Connector` has a `projectId`, every `Project` has a `clientId` — all three are required,
  non-nullable FKs already), and `Repository.clientId` is added as required (`NOT NULL`) only
  after the backfill step, in the same migration, so there is no window where a row could be left
  without one.
- **`linkRepository`'s changed uniqueness semantics** could surprise a caller still expecting
  "always creates a new repository." → Mitigation: no external API contract exists for this
  function today (it's an internal domain command reached only through the existing
  `RepositoryLinkForm` UI action); the modified capability's scenarios cover both the create and
  reuse paths explicitly.
- **Two places now decide "should this project's data show up"** (client-level `active` and
  whatever project-level state already exists) → Mitigation: this slice adds exactly one new
  filter dimension (client `active`), applied at the same two call sites (`listClients`-derived
  Dashboard data, `getItemsNeedingAttention`) that already do access-scoping — not a new,
  separate mechanism.

## Migration Plan

1. Schema migration: add `Repository.clientId` (nullable), `ProjectRepository` table,
   `Client.active` (default `true`).
2. Data migration: backfill `Repository.clientId` for every existing row via the
   `connectorId → connector.projectId → project.clientId` join.
3. Schema migration: make `Repository.clientId` `NOT NULL` now that every row has one.
4. Application code: `linkRepository` updated to find-or-create by client; new Client
   commands/routes/UI; Clients hub pages; Dashboard/Attention Center's client-scoped queries gain
   the `active` filter.

No rollback complexity beyond the standard `prisma migrate` down path — no data is deleted or
transformed destructively at any step.
