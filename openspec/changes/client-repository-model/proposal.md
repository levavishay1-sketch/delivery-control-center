## Roadmap Source

Implements Slice 12 of `docs/ROADMAP.md` ("Client-owned Repository model + Clients hub"), sourced
from `docs/roadmap-sources/2026-08-16-product-vision-blueprint.md` §5.1, §5.2, and §3:

> "**Repository — client-owned, project-independent.** Today `Repository` is 1:1 with `Connector`,
> which is 1:1 with `Project` — a repository cannot exist without a project. Target:
> `Repository.clientId` FK, directly on `Client`. A repository can exist under a client with
> **zero** projects linked to it. `ProjectRepository` join (new, many-to-many) is how a Project
> selects/links relevant repositories from the client's pool — never the other way around."

> "Client hub → client detail page (projects, repositories, information sources together)...
> `createClient()` exists but is unreachable — no route, no UI, no edit beyond budget, no
> delete/deactivate (no such schema field)."

This is Slice 12, the second of eleven dependency-ordered slices (11–21). It is the foundational,
highest-risk-because-structural slice — most of Slices 13–21 sit on top of it.

**Scope boundary (see design.md for the full reasoning):** the blueprint's end-state — "a
repository can exist under a client with zero projects" — depends on Slice 13's broader,
client-owned information-source model (a repository still needs *some* fetchable git connection
to be created from, and today that's only a project's `Connector`). This slice delivers the parts
of the vision that don't require that broader model yet: a repository becomes queryable and
reusable at the client level once it exists, and Client CRUD + a Clients hub become real. Fully
decoupling repository *creation* from a project's connector is Slice 13's job, not this one's.

## Why

Two things block the entire Slice 11–21 roadmap today. First, `Repository.connectorId` is
`@unique` and `Connector.projectId` is `@unique` — a rigid Project↔Connector↔Repository 1:1 chain
means a repository belongs exclusively to the one project whose connector created it, and cannot
be reused by another project under the same client even though the underlying git repository is
the same asset. Second, `createClient()` already exists in the domain layer but is completely
unreachable: there is no `POST /api/clients` route, no "New Client" UI, no way to edit a client
beyond its AI budget, and no way to deactivate one at all (the schema has no field for it). Every
later slice that needs "a client's repositories" or "manage a client" needs both of these fixed
first.

## What Changes

- Add `Repository.clientId` (FK to `Client`), backfilled for every existing row via
  `connectorId → connector.projectId → project.clientId`.
- Add a `ProjectRepository` join table (many-to-many Project ↔ Repository), so a repository, once
  it exists, can be linked as relevant to more than the one project whose connector created it.
- **BREAKING (internal only, no external API today)**: `engineering-evidence`'s repository-linking
  requirement changes from "a project links a repository through its own Connector, exclusively
  for that project" to "linking creates or reuses a client-owned repository and links it to the
  requesting project via `ProjectRepository`" — see the modified capability below. No public API
  contract exists yet for this to break.
- Wire real Client CRUD: `POST /api/clients` (using the existing `createClient()` command), a new
  update command + route + form for name/slug, and a new deactivate mechanism (`Client.active`
  field + command + route + UI action) — all org-admin gated via the existing `requireOrgAdmin`.
- Add a Clients hub: a nav item, a client list page, and a client detail page showing that
  client's projects, its repositories (across all projects, via the new `clientId`), and its
  connectors together.

## Capabilities

### New Capabilities

- `clients-hub`: the client list/detail UI — browsing a client's projects, repositories, and
  connectors together, and the deactivate action's user-facing behavior.

### Modified Capabilities

- `tenancy`: adds Client lifecycle requirements (create, edit, deactivate — all org-admin gated).
- `engineering-evidence`: modifies "A project can link a GitHub repository as a source of
  evidence" so linking creates-or-reuses a client-owned `Repository` and records the link via
  `ProjectRepository`, instead of creating a repository exclusively owned by that one project's
  connector.

## Impact

- **Schema/migration**: `Repository.clientId` (new FK, backfilled), new `ProjectRepository` table,
  new `Client.active` field. Existing `Repository.connectorId` is unchanged — repository creation
  still flows through a project's GitHub `Connector` in this slice (see scope boundary above).
- **Domain layer**: `src/domain/client/commands.ts` gains update/deactivate commands;
  `src/domain/evidence/commands.ts`'s `linkRepository` changes to create-or-reuse by client +
  record a `ProjectRepository` row instead of asserting global repository exclusivity to one
  project.
- **API routes**: new `POST /api/clients`, `PATCH /api/clients/[id]`,
  `POST /api/clients/[id]/deactivate` (or similar); existing evidence-linking route's underlying
  behavior changes per the modified capability, same request/response shape.
- **UI**: new Clients hub page(s) and nav entry, reusing Slice 10's design-system primitives
  (`Panel`, `Row`, `Button`, `FormField`, `StatusBadge`) and Slice 11's `InfoTooltip` where
  something (e.g. deactivation) needs explaining.
- **No changes** to `AI budget`, `SDD pipeline`, `Evidence enforcement`, or any other existing
  Slice 0–10 behavior beyond the repository-linking mechanism named above.
