## Roadmap Source

This change implements `docs/ROADMAP.md`'s Slice 4 row ("Connector
framework"), scoped from `docs/roadmap-sources/2026-08-14-gap-analysis-full.md`
§5 "Slice 4":

> - `Connector` and `SyncRun` entities (mode, authType, syncMode,
>   capabilities, status, lastSyncAt).
> - **Field-level provenance** — for each value: source, externalId, actor,
>   timestamp. The UI must answer "where did this value come from?" on any
>   field.
> - **Conflict handling**: default to *manual value wins and the conflict is
>   surfaced for review*. An external sync must never silently overwrite a
>   human edit.
> - Azure DevOps adapter. GitHub adapter.
> - Webhook intake, idempotent — duplicate delivery must not duplicate
>   anything.
> - No connector-specific logic inside the core domain.

Also closes gap register item #32 ("Retry/backoff on AI/integration calls")
for its still-outstanding half — `docs/ROADMAP.md` row 98 notes "Jira/
integration sync calls still have no retry, remains Slice 4 territory."

## Why

Today, syncing an external tracker is a single blocking call
(`IntegrationAdapter.fetchWorkItems`) invoked directly from an API route: no
history of sync attempts, no retry on transient failure, no record of which
external system last touched which field, and — most importantly — a
re-sync silently overwrites any field a human has since edited by hand. That
violates this product's own stated non-negotiable ("An external sync must
never silently overwrite a human edit") and leaves "where did this value
come from?" unanswerable, undermining the provenance story the product
claims as its "strongest, most fully-realized property" everywhere else.
Only one real adapter (Jira) exists; Azure DevOps is declared but stubbed
out.

## What Changes

- Add `Connector` entity: one per project-integration pairing, holding
  `mode` (e.g. pull/push), `authType`, `syncMode` (manual/scheduled —
  scheduling itself stays out of scope, see Non-Goals in design.md),
  `capabilities` (what the adapter supports), `status`
  (`CONNECTED`/`DISCONNECTED`/`ERROR`), `lastSyncAt`. Replaces
  `Project.integrationType`/`integrationConfig` as the source of truth for
  how a project's external tracker is reached — those fields migrate onto
  `Connector`.
- Add `SyncRun` entity: one row per sync attempt, with status, item counts
  (created/updated/conflicted), started/completed timestamps, and error
  detail on failure. Every sync — manual or webhook-triggered — creates one.
- Add `FieldProvenance` (or equivalent per-value tracking): for every
  work-item field that can be set by a sync, record source system, external
  id, the actor (system vs. a specific human edit), and timestamp of the
  value currently in place.
- **BREAKING** (internal only, no external API): sync-driven field writes
  that would overwrite a field with a pending human edit no longer apply
  silently — they create a surfaced conflict instead, requiring an explicit
  human resolution (keep manual / accept incoming).
- Add a real Azure DevOps adapter (currently stubbed — sync attempts fail
  loudly by design) and a new GitHub adapter (issues as work items, same
  shape as the existing Jira adapter), both implementing the existing
  `IntegrationAdapter` contract, invoked only through a `Connector`.
- Add an idempotent webhook intake endpoint per adapter capable of push
  delivery, deduplicated by a stable per-delivery key so a retried/duplicate
  webhook delivery never double-applies.
- Add retry with backoff around adapter calls (`fetchWorkItems`, webhook
  processing), using the same `Job`-backed retry pattern Slice 2 established
  for AI drafting — closing gap #32's remaining half.
- UI: connector configuration/status view per project, sync history
  (`SyncRun` list), a provenance affordance on any synced work-item field
  ("where did this come from?"), and a conflict-review surface for fields
  flagged as conflicted.

## Capabilities

### New Capabilities
- `connector-management`: `Connector`/`SyncRun` lifecycle — configuring a
  project's connector, triggering a sync, tracking sync history and status,
  retry/backoff on transient adapter failure.
- `field-provenance`: per-field source/externalId/actor/timestamp tracking
  for every synced work-item field, and surfacing "where did this value
  come from" in the UI.
- `sync-conflict-resolution`: detecting when an incoming synced value would
  overwrite a human-edited field, surfacing it as a reviewable conflict
  instead of applying it silently, and recording the human's resolution.
- `webhook-intake`: an idempotent, per-adapter webhook endpoint that
  triggers a `SyncRun` without duplicating effects on redelivery.

### Modified Capabilities
- `work-item-sync`: sync now runs through a project's `Connector` (not a
  bare `IntegrationAdapter` call keyed off `Project.integrationType`
  directly), creates a `SyncRun` per attempt, records field provenance for
  every value it writes, and defers to `sync-conflict-resolution` instead of
  overwriting a human-edited field. Its existing "integration type with no
  real adapter is explicitly unavailable" requirement is updated: Azure
  DevOps changes from unavailable to a real adapter; the requirement itself
  (an adapter-less type stays unavailable, no silent fallback) still holds
  for any future type without one.

## Impact

- **Schema**: new `Connector`, `SyncRun` models; a provenance mechanism
  (new model or JSON column, decided in design.md) on `WorkItem`; migration
  moving `integrationType`/`integrationConfig` off `Project` and onto
  `Connector` (with a backfill for existing projects, per this project's
  established additive-then-backfill migration pattern).
- **Domain**: new `src/domain/connector/` (commands/queries), changes to
  `src/domain/work-item/` sync commands to route through a `Connector` and
  check for conflicts before writing.
- **Adapters**: `src/lib/integrations/` gains `azureDevOps.ts`, `github.ts`;
  the `IntegrationAdapter` interface may grow a webhook-handling method.
- **API**: new routes for connector CRUD, sync trigger, `SyncRun` listing,
  conflict listing/resolution, and one webhook-intake route per
  push-capable adapter.
- **UI**: project settings gains connector configuration; work-item detail
  gains a provenance affordance per field and a conflict-resolution surface
  when one exists.
- **No connector-specific logic in the core domain** — `src/domain/`
  depends only on the `IntegrationAdapter`/`Connector` abstractions, never on
  a specific provider's shape, matching this project's existing
  swappable-adapter architecture principle.
