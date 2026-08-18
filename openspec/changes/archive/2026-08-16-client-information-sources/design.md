## Context

`Connector` is created the same transaction as its `Project` (`createProject`,
`src/domain/project/commands.ts`) or lazily backfilled by
`getOrCreateConnectorForProject` (`src/domain/connector/commands.ts`). It is the live sync engine:
`SyncRun`, `WebhookDelivery`, and `SyncConflict` all key off `connectorId`, and
`src/domain/connector/sync.ts` resolves "which project do these synced `WorkItem`s belong to" via
`connector.projectId` at every step. `IntegrationType` (`MANUAL | JIRA | AZURE_DEVOPS | GITHUB`) is
exhaustively matched in three places: `DEFAULT_AUTH_TYPE` (`commands.ts`), `configureConnector`'s
zod enum, and `ConnectorConfigForm`'s type `<select>`.

`getClientDetail` (Slice 12, `src/domain/client/queries.ts`) currently derives a client's
connectors indirectly: `projects.map(p => p.connector).filter(c => c !== null)`. See proposal.md
for the motivation and explicit scope boundary — this design does not touch the sync engine's
`connectorId`-keyed machinery, only `Connector`'s client attribution and the enum's named range.

## Goals / Non-Goals

**Goals:**
- `Connector.clientId` queryable directly, mirroring `Repository.clientId` (Slice 12).
- `IntegrationType` names the real range of client information sources from the vision, as a
  closed enum (Q3), so later slices (14 SDD bootstrap, 15 relevance recommendation) can reference
  real values instead of forcing another schema migration first.

**Non-Goals:**
- Any adapter, fetch logic, or UI reachability for the five new `IntegrationType` values — they
  exist in the schema, named, and nothing else. The existing "unimplemented connector type"
  requirement already governs this; this change extends its scope to cover them, not create new
  behavior for them.
- Decoupling `Connector` from `Project` (no `ProjectConnector` join, no shared connector across
  projects) — out of scope per proposal.md, deferred to a later slice.

## Decisions

**`Connector.clientId` is a required, backfilled FK — `projectId` stays required and `@unique`.**
Exactly mirrors Slice 12's `Repository.clientId` decision: adding `clientId` alongside the existing
`projectId` (rather than replacing it) keeps every sync/webhook code path that already keys off
`connectorId`/`projectId` working unchanged. The backfill derives `clientId` for every existing row
via `connector.projectId → project.clientId` (a single SQL `UPDATE ... FROM` join, in its own data
migration, per this project's convention).

**Five new `IntegrationType` values: `CRM`, `TEAMS`, `MCP`, `CUSTOM_API`, `OTHER`.** Chosen to
name the concrete categories the vision lists ("work trackers, CRM, chat/Teams-type tools, MCP,
custom API, manual") without inventing vendor-specific values (no `SALESFORCE`, no `SLACK`) — a
category-level enum stays closed and small while still covering "the real range," matching Q3's
"expanded Enum, not a completely open/custom-defined model." `OTHER` is a bounded escape hatch for
a source that doesn't fit a named category, not a general-purpose custom-type mechanism — it is
still one fixed enum value, reachable through the same "not yet available" gate as the rest until a
real adapter exists for it.

**The new types stay unreachable through `configureConnector`/`ConnectorConfigForm` — reusing the
existing "unimplemented connector type" requirement rather than adding a new one.** The alternative
(let a user select `CRM` and store it with `status: DISCONNECTED`, no adapter) would create a
connector that looks configured but can never sync — worse than not offering it. Keeping
`configureConnector`'s zod enum and the form's `<select>` exactly as they are today (unchanged)
means the five new values are visible only in `prisma/schema.prisma` and the database until a real
adapter slice extends both.

**`getClientDetail` reads connectors via `clientId` directly, not `projects.map(p => p.connector)`.**
Small, purely internal change (Slice 12's `src/domain/client/queries.ts`) — same output shape, same
Clients hub UI, one fewer indirection. No spec-level behavior change (the Clients hub's existing
"shows its connectors" requirement is unaffected), so no delta needed for `clients-hub`.

## Risks / Trade-offs

- **Backfill correctness** for `Connector.clientId`: every existing connector row must resolve a
  client via its project. → Mitigation: `connector.projectId` is a required, non-nullable FK
  already, and every `Project` has a required `clientId` — the `UPDATE ... FROM` join covers every
  row by construction, and `clientId` is added as required only after the backfill runs, same
  three-step pattern as Slice 12.
- **A wide, unreachable enum could look like dead code to a future reader.** → Mitigation: the
  MODIFIED `connector-management` requirement and this design doc name the five values and state
  explicitly why they exist now but aren't reachable yet — the same "declared, gated, not yet
  offered" shape the existing "unimplemented connector type" requirement already established for
  `AZURE_DEVOPS`'s early state (per Slice 4's history) before its adapter landed.

## Migration Plan

1. Schema migration: add `Connector.clientId` (nullable), five new `IntegrationType` enum values.
2. Data migration: backfill `Connector.clientId` for every existing row via
   `connector.projectId → project.clientId`.
3. Schema migration: make `Connector.clientId` `NOT NULL` now that every row has one.
4. Application code: `getClientDetail` reads connectors via `clientId` directly.

No rollback complexity beyond the standard `prisma migrate` down path — no data is deleted or
transformed destructively at any step.
