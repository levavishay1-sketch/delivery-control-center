## Context

Today (post-Slice 3): `Project.integrationType`/`integrationConfig` name
which `IntegrationAdapter` (`src/lib/integrations/`) a sync call uses;
`POST /api/projects/[id]/sync` calls `getIntegrationAdapter(type)
.fetchWorkItems(config)` directly and upserts `WorkItem` rows in one pass,
with no retry, no run history, and no protection for a field a human has
since edited by hand — a re-sync just overwrites it. `IntegrationType` has
`MANUAL`/`JIRA`/`AZURE_DEVOPS`, but only `manual.ts`/`jira.ts` have real
adapters; `AZURE_DEVOPS` deliberately throws (`getIntegrationAdapter`) since
no adapter is registered for it. Retry/backoff and atomic job claiming
already exist for AI drafting (`Job`/`claimJobs`/`failJob`,
`src/domain/job/commands.ts`) — Slice 2's durable-execution pattern. See
proposal.md for the full "why."

## Goals / Non-Goals

**Goals:**
- A project's external-tracker connection becomes an inspectable resource
  (`Connector`) with real status, not two loose fields on `Project`.
- Every sync attempt — manual or webhook-triggered — is a `SyncRun` with
  its own history, retried with backoff on transient failure via the
  existing `Job` runtime rather than a new one.
- A field a human has edited is never silently clobbered by a later sync;
  disagreement becomes a reviewable conflict.
- Every synced field can answer "where did this come from" — source,
  external id, actor, timestamp.
- Azure DevOps and GitHub become real, working adapters.
- A push-capable adapter can deliver a webhook that triggers a sync exactly
  once per logical delivery, however many times it's retried in transit.

**Non-Goals:**
- Scheduled/polled sync. `Connector.syncMode` records a project's intended
  mode (manual vs. scheduled) as data, but actually running syncs on a
  timer (a cron-like scheduler) is not built here — every sync in this
  slice is still triggered by a human action or an inbound webhook. Adding
  a scheduler is straightforward on top of this once wanted, but isn't
  asked for by the source scope and isn't invented here.
- Two-way sync (writing this system's changes back out to Jira/Azure
  DevOps/GitHub). The source scope's conflict handling is about *this
  system* not overwriting a human edit on *inbound* sync; it says nothing
  about pushing local changes upstream. Adapters stay fetch/webhook-in
  only, same shape as today's `IntegrationAdapter.fetchWorkItems`.
- Field-level provenance/conflict handling for non-synced fields (risk,
  priority, owner, executor, etc. — Slice 1 delivery-model fields humans
  set directly). Provenance only applies to the fields a sync can write
  (title, description, status, externalUrl) — exactly the set
  `FetchedWorkItem` already returns.
- A generic webhook-signature-verification framework. Each adapter
  implements its own verification against its own provider's scheme
  (GitHub's HMAC-SHA256, Azure DevOps' Basic Auth on the webhook URL) —
  no shared abstraction invented beyond the existing `IntegrationAdapter`
  boundary.
- Retiring `Project.integrationType`/`integrationConfig` immediately. They
  are migrated onto `Connector` and then unused by new code, but dropped
  in this slice's migration once the backfill is verified — not left
  dangling, but not a separate "deprecation window" either, matching this
  project's existing additive-then-cleanup migration pattern (e.g. Slice
  2's `stageSequence`).

## Decisions

### 1. `Connector` is 1:1 with `Project`, not a separate many-connector model
The source names `Connector` as an entity but a project has exactly one
external tracker today (`Project.integrationType` is a single enum, not a
list) and nothing in the source scope asks for a project to sync from
multiple trackers at once. `Connector.projectId` is unique — one row per
project, created automatically (as `MANUAL`/`DISCONNECTED`-equivalent) the
same moment a `Project` is created, so "does this project have a
connector" is never a null case to special-case around.

**Alternative considered**: many `Connector`s per project (a project could
sync from both Jira and GitHub). Rejected — no source requirement asks for
multi-source sync into one project, and `WorkItem`'s existing
`@@unique([projectId, source, externalId])` already assumes `source` (an
`IntegrationType`) disambiguates within one project's items, not across
independently-configured connectors of the same type. Revisit only if a
real multi-source requirement shows up.

### 2. Sync runs through the existing `Job` runtime, not a new queue
A triggered sync (manual button or webhook) enqueues a `JobType.SYNC_PROJECT`
job (`payload: { connectorId }`) via the existing `enqueueJob`/`claimJobs`/
`failJob` machinery `worker.ts` already runs. `SyncRun` is created when the
job is claimed (mirroring how `AgentRun` is created when a `DRAFT_STAGE` job
is claimed, Slice 3 decision 1) and finalized when the job reaches a
terminal state. Retry/backoff, atomic claiming, and crash-durability are
inherited for free — no second retry mechanism invented.

**Alternative considered**: a bespoke retry loop inside the sync API route
(e.g. an in-process `setTimeout` retry). Rejected — that dies on process
restart, exactly the failure mode `Job` exists to survive, and Slice 2/3
both already established "durable async work is a `Job`" as this project's
one pattern for it.

### 3. Conflict detection compares against `FieldProvenance`, not a value snapshot
Each synced field (`title`, `description`, `status`, `externalUrl`) gets a
`FieldProvenance` row (`workItemId`, `field`, `source` — `SYNC` or `MANUAL`
— `externalId`, `actorUserId` nullable for `SYNC`, `updatedAt`). A sync
write first reads the field's current `FieldProvenance.source`: if `MANUAL`
and the incoming value differs from the field's current value, it creates/
updates a `SyncConflict` row instead of writing; otherwise it writes the
field and upserts `FieldProvenance` with `source: SYNC`. A manual edit
(`PATCH` on a work item) always upserts `FieldProvenance` with
`source: MANUAL` for the fields it touches, regardless of what synced them
before.

**Alternative considered**: diff against the field's value as of the last
successful sync (a value snapshot per field) rather than tracking an
explicit actor. Rejected — the source explicitly asks for provenance
("source, externalId, actor, timestamp") as its own deliverable, and
reusing that same record to drive conflict detection avoids a second,
redundant tracking mechanism that could drift out of sync with it.

### 4. `SyncConflict` is one row per (work item, field), upserted, not append-only
Unlike `AuditEvent`/`StageVersion` (deliberately append-only history), a
`SyncConflict` represents *current* unresolved disagreement — resolving it
closes the row; a later sync that produces a new incoming value while the
old conflict is still unresolved updates the same row's `incomingValue`
rather than stacking a second one for the same field (per the spec's "not
duplicated if the incoming value is unchanged" scenario, extended here to
"replaced, not duplicated, if it changed again"). Resolution itself *is*
audited via the existing `AuditEvent` mechanism — the conflict's current
state doesn't need its own history when the audit trail already carries
one.

**Alternative considered**: append-only conflict log mirroring
`AuditEvent`. Rejected — a UI answering "what needs my review right now"
wants current open conflicts, not a log to replay; the audit trail already
gives history for the resolution action itself.

### 5. Webhook idempotency: a `WebhookDelivery` dedup table keyed by adapter + delivery id
Each adapter capable of push delivery supplies a stable delivery id (GitHub:
`X-GitHub-Delivery` header; Azure DevOps: the webhook payload's own
`id` field). `WebhookDelivery(connectorId, deliveryId)` is unique; the
webhook route inserts before processing (`ON CONFLICT DO NOTHING` /
Prisma's equivalent create-or-skip) and only proceeds to enqueue a
`SYNC_PROJECT` job if the insert actually happened. A redelivered id sees
the insert no-op and returns 200 without enqueueing a second job.

**Alternative considered**: idempotency via `Job.idempotencyKey` alone
(already unique, already dedupes `enqueueJob` calls). Rejected as
insufficient on its own — it would dedupe two *jobs* from the same
delivery id, but a webhook handler that does any work before enqueueing
(logging, targeted-item extraction) needs the check earlier, at intake,
not buried inside the enqueue call; a dedicated table also gives a
listable receipt log for debugging redelivery issues, which `Job` rows
(scoped to sync *execution*, not delivery *receipt*) don't naturally offer.

### 6. Azure DevOps and GitHub adapters follow the exact `IntegrationAdapter` shape Jira already established
Both new adapters implement `fetchWorkItems(config): Promise<FetchedWorkItem[]>`
exactly like `jiraAdapter` — resolving config from `Connector`'s stored
config (falling back to env vars the same way `jira.ts` does), calling the
provider's REST API, mapping to `FetchedWorkItem`. GitHub issues map
`number`→`externalId`, `title`→`title`, `body`→`description`, `state`→
`status`. Azure DevOps work items map `id`→`externalId`,
`fields['System.Title']`→`title`, `fields['System.Description']`→
`description`, `fields['System.State']`→`status`. No connector-specific
branching enters `src/domain/` — the domain layer calls
`getIntegrationAdapter(connector.type)` exactly as it calls it today,
unaware of which provider that resolves to.

## Risks / Trade-offs

- **[Risk]** Backfilling `Connector` from every existing `Project`'s
  `integrationType`/`integrationConfig` and then dropping those columns in
  the same slice is a bigger single migration than this project's usual
  "additive now, cleanup later" split. → **Mitigation**: split into two
  migrations per this project's own established convention (Slice 3
  decision 2's precedent) — first additive (`Connector` created, backfilled,
  `WorkItem`/sync code switched to read from it), verified against real
  local Postgres; only then a second migration drops the now-unused
  `Project` columns, run and verified separately.
- **[Risk]** A `SyncConflict` left unresolved indefinitely silently stops
  that one field from ever syncing again, which could look like "sync is
  broken" to a user who doesn't know to check the conflicts view. →
  **Mitigation**: the Attention Center (Slice 1) is the existing "needs a
  human" surface in this product; an open `SyncConflict` becomes a new
  Attention Center entry type, so it's not a screen a user has to
  remember to check separately.
- **[Risk]** Webhook signature verification differs per provider and is
  easy to get subtly wrong (timing-safe comparison, correct header,
  correct secret). → **Mitigation**: use Node's built-in `crypto.timingSafeEqual`
  for the comparison step in every adapter's verifier, and test each
  adapter's verifier against that provider's own documented example
  payload/signature pair, not just a self-generated one.

## Migration Plan

1. Additive migration: `Connector`, `SyncRun`, `FieldProvenance`,
   `SyncConflict`, `WebhookDelivery` tables; `JobType` gains
   `SYNC_PROJECT`; `IntegrationType` gains `GITHUB`. No existing column
   touched yet.
2. Backfill migration: one `Connector` per existing `Project`, copying
   `integrationType`→`Connector.type`/`integrationConfig`→`Connector.config`,
   `status: CONNECTED` if `integrationType != MANUAL` else a manual-mode
   equivalent. Verified against real local Postgres: every `Project` has
   exactly one `Connector` after this step.
3. Application code cutover: sync API route, `work-item` sync commands,
   and any other reader of `Project.integrationType`/`integrationConfig`
   switch to reading through `Connector`.
4. Cleanup migration (separate commit, after the cutover is verified
   working end-to-end): drop `Project.integrationType`/`integrationConfig`.

Rollback: each migration is reversible independently before the next is
applied; once the cleanup migration (step 4) has run, rollback requires
restoring the dropped columns from the `Connector` rows that superseded
them (a reverse-backfill), same as any additive-then-drop migration in
this codebase.
