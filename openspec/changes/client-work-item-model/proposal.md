# Proposal: Client Work Item / Repository / Connection model

## Roadmap Source

`docs/roadmap-sources/2026-08-18-client-work-item-model.md` — a full, explicitly-decided
implementation specification. Supersedes the discovery-only framing of
`docs/roadmap-sources/2026-08-18-client-area-product-model.md`. The user states the product
decisions directly and instructs against re-asking anything already answered there.

## Why

The Client detail page (`/clients/[id]`) today mixes three product concepts that the roadmap
source requires to be reconciled into a single, consistent model:

1. A separate `Requirement` entity with its own creation form, detail page, and lifecycle
   (`OPEN`/`SDD_ACTIVE`/`DECLINED`), which only becomes a `WorkItem` via an explicit, separate
   "Start SDD" action. The roadmap source retires this split: *"There is no Requirement → Work
   Item conversion step... The object itself is the Work Item."*
2. A `Connector` that is strictly 1:1 with a `Project` (always exists, even for `MANUAL` mode),
   configured only from Project Settings, with no detail page and no client-level, freely-addable
   semantics. The roadmap source wants a `CONNECTIONS` section that is a genuine client-level list
   the user can add to and remove from independently of any Project.
3. A `Repository` creation path (`linkRepository`) that requires a GitHub-typed `Connector` on a
   Project and performs a live GitHub API fetch — not the simple, direct "Source + Link" creation
   the roadmap source specifies.

This change reconciles all three: `Requirement` is retired in favor of `WorkItem` directly (no
parallel entity), a new lightweight `Connection` model is introduced for the client-level list
(keeping `Connector` as the Project-scoped sync-engine's internal implementation detail, since it
is genuinely still required there), and `Repository` gains a direct creation path alongside its
existing GitHub-evidence-linking path.

## What Changes

- **Retire `Requirement`** as a distinct model/route/UI. Its data shape (client-owned, optional
  Project link, type+title mandatory/rest optional) is absorbed into `WorkItem` creation directly.
- **`WorkItem` creation becomes Client-facing and Project-optional in the UI**: a dedicated
  creation screen requires only Type + Title. When no Parent is selected, a Project is
  auto-resolved (created) for the WorkItem exactly the way `startSddForRequirement` already
  auto-creates one for a standalone Requirement today — reusing `generateProjectKey`/
  `createProject` verbatim. When a Parent is selected, the new WorkItem is created under the
  parent's existing Project (preserving the existing "hierarchy is same-project" rule).
- **`WorkItem` gains a `source` field exposed on the creation form** (reusing the existing
  `source: IntegrationType` column, currently hardcoded to `MANUAL` on every manually-created
  WorkItem) and an optional many-to-many relation to `Repository` ("Related Repositories"),
  enforced same-client at the domain layer.
- **`Repository` gains a direct creation path**: a new `source` (string, extensible) and `url`
  fields, with `connectorId` becoming nullable so a Repository can exist without going through the
  GitHub-Connector evidence-linking flow. The existing `linkRepository` (Connector-driven,
  GitHub-fetch) path is unchanged and continues to populate `owner`/`name`/`externalId`/
  `connectorId` for engineering-evidence purposes.
- **New `Connection` model**: a simple, client-owned (`clientId`, `source`, `name`) object, with
  its own creation/detail/edit/delete UI. `Connector` is unchanged and stays the Project-scoped
  sync-engine implementation detail (webhooks, `SyncRun`, `FieldProvenance`, `SyncConflict` all key
  off it) — it is no longer surfaced on the Client page.
- **Client page restructured**: header shows Client name + `slug` (the existing identifier, not a
  new one); three sections — WORK ITEMS (top-level WorkItems, all statuses, all types, no
  filters), REPOSITORIES, CONNECTIONS — each with a dedicated (non-inline) creation screen and
  each row linking to a dedicated detail screen.
- **Dashboard is unaffected**: it already queries the same `Project` model `getClientDetail` uses;
  no change needed to satisfy "one Project mechanism."

## Impact

- Affected specs: `requirement-lifecycle` (retired — its capability is folded into
  `work-item-model`), `work-item-model` (extended: `source` exposed, Repository relation,
  Project-resolution-on-creation), `clients-hub` (Client page structure), `connector-management`
  (Purpose note only — clarifies `Connector` stays internal), new `client-connections` capability.
- Affected code: `prisma/schema.prisma` (new `Connection` model, `WorkItemRepository` join model,
  `Repository.source`/`url` columns + nullable `connectorId`, drop `Requirement` model), the
  `requirement` domain module (removed), `work-item` domain module (extended), new `connection`
  and repository-creation domain commands, `/clients/[id]/page.tsx` restructuring, new dedicated
  creation/detail routes.
- No change to `Dashboard`, `Connector`, `SyncRun`, webhook routes, or engineering-evidence
  machinery.
