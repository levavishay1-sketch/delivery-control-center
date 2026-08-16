## Roadmap Source

Implements `docs/ROADMAP.md`'s Slice 13 row, sourced from
`docs/roadmap-sources/2026-08-16-product-vision-blueprint.md`:

- §3 (target data model additions): *"Information sources — an expanded, closed enum,
  client-owned... Today `Connector` is scoped 1:1 per **Project**, and `IntegrationType` is a
  narrow enum (`MANUAL | JIRA | AZURE_DEVOPS | GITHUB`). Target: the owning concept is the
  **Client**, not the Project. `IntegrationType` grows into an **expanded enum** covering the real
  range of sources a client needs (work trackers, CRM, chat/Teams-type tools, MCP, custom API,
  manual, etc.) — explicitly **not** a fully open/admin-defined taxonomy."*
- §10 (sequencing table), row 13: *"`client-information-sources` — Broaden
  `Connector`/`IntegrationType` into a client-owned, expanded-enum source model (§3, §5.4
  groundwork) — Depends on: 12."* Slice 12 (`client-repository-model`) is archived at
  `openspec/changes/archive/2026-08-16-client-repository-model/`.
- Appendix Q3 (verbatim): *"`IntegrationType` should be an expanded Enum, not a completely
  open/custom-defined model. The Enum should be expanded to represent the range of information
  sources the system needs to support and should not remain limited to Jira / Azure DevOps /
  GitHub."*

## Why

Two structural gaps block the later source-relevance and SDD-bootstrap slices (14, 15): a
`Connector` is only ever visible through the one `Project` that created it (no client-level
attribution, unlike `Repository` after Slice 12), and `IntegrationType` cannot name a CRM, a
chat tool, an MCP source, or a custom API — only the four values this product started with. This
slice lays the client-ownership and taxonomy groundwork those later slices need, without
redesigning the sync engine itself.

## What Changes

- Add `Connector.clientId` (backfilled via the existing `connector.projectId → project.clientId`
  chain, then made required — the same three-step migration pattern Slice 12 used for
  `Repository.clientId`), so a `Connector` is attributable to its client directly, not only via its
  project.
- Expand `IntegrationType` with five new closed-enum values naming the real range of sources named
  in the vision: `CRM`, `TEAMS`, `MCP`, `CUSTOM_API`, `OTHER` — still a closed enum per Q3, not an
  admin-defined/open taxonomy.
- The five new types are **not** yet selectable or configurable anywhere (no adapter exists for
  any of them) — the existing "an unimplemented connector type is explicitly unavailable"
  requirement already governs this, and now explicitly covers them by name.
- The Clients hub's existing "Connectors" panel (Slice 12) reads a client's connectors directly via
  `clientId` instead of indirecting through each project's connector — an internal query change,
  not a behavior change (still shows the same connectors).

**Non-goals, explicitly out of scope for this slice** (deferred to later slices per the
roadmap's own sequencing):
- Decoupling `Connector` from its 1:1 relationship with `Project` (no `ProjectConnector` join, no
  connector shared across multiple projects) — `Connector` remains the live sync engine keyed by
  `connectorId` throughout `SyncRun`/`WebhookDelivery`/`SyncConflict`/the adapters, unchanged.
- Any real adapter for `CRM`/`TEAMS`/`MCP`/`CUSTOM_API` — building fetch/sync logic for these is
  Slice 15+ territory, once source-relevance recommendation is in scope.
- Any new client-level "sources" page/hub UI — the Clients hub's existing Connectors panel already
  covers the client-scoped visibility this slice's data model enables.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `connector-management`: `Connector` gains client-level attribution (`clientId`), and the
  existing "unimplemented connector type" requirement is clarified to explicitly name the five new
  `IntegrationType` values as not-yet-available, same as any other unimplemented type.

## Impact

- `prisma/schema.prisma`: `IntegrationType` enum (+5 values), `Connector.clientId` (nullable →
  backfilled → required), `@@index([clientId])`.
- Three migrations (additive/nullable, data backfill, `NOT NULL`), mirroring Slice 12's pattern.
- `src/domain/client/queries.ts`'s `getClientDetail`: connectors resolved via `clientId` directly
  instead of via `projects.map(p => p.connector)`.
- No route, UI, or adapter changes — `configureConnector`'s zod schema and
  `ConnectorConfigForm`'s type selector are unchanged (the new types stay unreachable, per the
  unimplemented-type requirement).
