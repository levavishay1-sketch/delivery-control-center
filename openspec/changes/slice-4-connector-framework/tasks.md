# Tasks: Slice 4 — Connector Framework

## Overview

Replaces the bare `Project.integrationType`/`integrationConfig` sync
mechanism with a real `Connector`/`SyncRun` lifecycle running through the
existing `Job` runtime, adds field-level provenance and manual-wins
conflict resolution so a sync can never silently clobber a human edit,
ships real Azure DevOps and GitHub adapters, and adds idempotent webhook
intake. Tasks are grouped into logical units, each testable and
committable independently, per this project's change-sizing convention
(see Slice 2/3's tasks.md for the established pattern).

## Task Group 1: Data Model & Migrations (6 tasks)

- [x] 1.1 Add `Connector` model: `id`, `projectId` (unique FK to `Project`), `type` (`IntegrationType`), `mode` (new `ConnectorMode` enum: `PULL`/`PUSH`/`BOTH`), `authType` (String), `syncMode` (new `SyncMode` enum: `MANUAL`/`SCHEDULED` — `SCHEDULED` recorded as data only, see design.md Non-Goals), `capabilities` (`String[]` or `Json`), `config` (`Json?`, encrypted credential fields per the existing `encryptIntegrationConfig`/`decryptIntegrationConfig` pattern), `status` (new `ConnectorStatus` enum: `CONNECTED`/`DISCONNECTED`/`ERROR`), `lastSyncAt` (`DateTime?`), `createdAt`/`updatedAt`.
- [x] 1.2 Add `SyncRun` model: `id`, `connectorId` (FK), `jobId` (nullable FK to `Job`), `status` (new `SyncRunStatus` enum: `RUNNING`/`SUCCEEDED`/`FAILED`), `itemsCreated`/`itemsUpdated`/`itemsConflicted` (Int, default 0), `error` (`String?`), `startedAt`, `completedAt` (nullable), `createdAt`.
- [x] 1.3 Add `FieldProvenance` model: `id`, `workItemId` (FK), `field` (String — one of `title`/`description`/`status`/`externalUrl`), `source` (new `ProvenanceSource` enum: `SYNC`/`MANUAL`), `externalId` (`String?`, set for `SYNC`), `actorUserId` (nullable FK to `User`, set for `MANUAL`), `updatedAt`. `@@unique([workItemId, field])` — one current-provenance row per field.
- [x] 1.4 Add `SyncConflict` model: `id`, `workItemId` (FK), `field` (String), `currentValue` (String), `incomingValue` (String), `connectorId` (FK), `resolvedAt` (`DateTime?`, null = open), `resolvedByUserId` (nullable FK to `User`), `resolution` (new `ConflictResolution` enum, nullable: `KEPT_MANUAL`/`ACCEPTED_INCOMING`), `createdAt`. `@@unique([workItemId, field])` partial-unique-equivalent enforced in the domain command (one open conflict per field, same pattern `Agent.isDefault`'s exactly-one-true rule uses).
- [x] 1.5 Add `WebhookDelivery` model: `id`, `connectorId` (FK), `deliveryId` (String, provider-supplied), `receivedAt`. `@@unique([connectorId, deliveryId])`. Extend `JobType` with `SYNC_PROJECT`; extend `IntegrationType` with `GITHUB`.
- [x] 1.6 Additive migration for everything above (all new tables; `Project.integrationType`/`integrationConfig` untouched — no backfill combined with schema, per Slice 2/3's established split). Run against real local Postgres; confirm all new tables and enum values exist with no data loss to existing tables.

## Task Group 2: Connector Backfill & Cutover (4 tasks)

- [x] 2.1 Backfill migration (separate from 1.6, per this project's own precedent): create one `Connector` per existing `Project`, copying `integrationType`→`type`, `integrationConfig`→`config`, `status: CONNECTED` if `integrationType != MANUAL` else the manual-mode equivalent, `mode: PULL`, `authType` inferred per type (e.g. `"api_token"` for `JIRA`), `capabilities: []`. Verify every `Project` has exactly one `Connector` after this step.
- [x] 2.2 `src/domain/connector/commands.ts`: `getOrCreateConnectorForProject(projectId)`, `configureConnector(ctx, projectId, { type, config, mode, authType, syncMode })` (`WRITE_ROLES`-gated). `src/domain/connector/queries.ts`: `getConnector(projectId)`, `listSyncRuns(connectorId)`.
- [x] 2.3 Cut over `POST /api/projects/[id]/sync` and any other reader of `Project.integrationType`/`integrationConfig` to read through `Connector` instead. `getIntegrationAdapter` is now called with `connector.type`, not `project.integrationType`.
- [x] 2.4 Tests: backfill produces exactly one `Connector` per `Project` with correct field mapping; `configureConnector` rejects a non-`WRITE_ROLES` caller; `getOrCreateConnectorForProject` is idempotent (a second call for the same project returns the same row, never creates a duplicate). Commit: "Add the Connector entity, backfilled from existing Project integration config"

## Task Group 3: Sync via the Job Runtime (5 tasks)

- [x] 3.1 `src/domain/connector/commands.ts`: `triggerSync(ctx, connectorId)` — `WRITE_ROLES`-gated, enqueues a `JobType.SYNC_PROJECT` job (`payload: { connectorId }`, idempotency key scoped to connector + a time bucket or "no other RUNNING SyncRun for this connector" check so a double-click doesn't enqueue two concurrent syncs).
- [x] 3.2 `worker.ts`'s new `handleSyncProjectJob`: creates a `SyncRun` (`status: RUNNING`) when the job is claimed, calls `getIntegrationAdapter(connector.type).fetchWorkItems(connector.config)`, upserts `WorkItem` rows via the (now provenance/conflict-aware — Task Group 4) sync logic, finalizes the `SyncRun` (`SUCCEEDED` with item counts, or reschedules via `failJob`'s existing backoff on a transient error).
- [x] 3.3 On job retry (not final exhaustion): keep the `SyncRun` `RUNNING`, no new row created — same pattern Slice 3 decision 1 established for `AgentRun`/`Job` retries. On final exhaustion: `SyncRun` → `FAILED` with `error` set, `Connector.status` → `ERROR`.
- [x] 3.4 `Connector.lastSyncAt`/`status` updated to `CONNECTED` on every `SyncRun` success.
- [x] 3.5 Tests: `triggerSync` creates exactly one `SyncRun` per attempt-cycle, surviving retries without duplicating; a transient adapter failure is retried with backoff and eventually succeeds; exhausted retries mark both `SyncRun` and `Connector` failed/`ERROR` with the last error recorded; a second `triggerSync` call while one is already `RUNNING` for that connector is refused or safely idempotent (no two concurrent `SyncRun`s for one connector). Commit: "Run project sync through the Job runtime as a SyncRun, with retry/backoff"

## Task Group 4: Field Provenance & Conflict Resolution (6 tasks)

- [ ] 4.1 `src/domain/connector/provenance.ts`: `recordSyncProvenance(workItemId, field, externalId)` and `recordManualProvenance(workItemId, field, actorUserId)` — upsert `FieldProvenance` by `[workItemId, field]`.
- [ ] 4.2 `src/domain/work-item/commands.ts`'s manual-edit path (`updateWorkItem` or equivalent): after writing a field a sync can also write (`title`/`description`/`status`/`externalUrl`), calls `recordManualProvenance` for each touched field, in the same transaction as the write.
- [ ] 4.3 Sync's upsert logic (Task Group 3.2's `handleSyncProjectJob`): before writing each syncable field, checks `FieldProvenance.source` for that `[workItemId, field]`. If `MANUAL` and the incoming value differs from the current value, calls `createOrUpdateSyncConflict` instead of writing (increments the `SyncRun.itemsConflicted` counter) and leaves the field untouched. Otherwise writes the field and calls `recordSyncProvenance`.
- [ ] 4.4 `src/domain/connector/conflicts.ts`: `createOrUpdateSyncConflict(workItemId, field, currentValue, incomingValue, connectorId)` — upserts by `[workItemId, field]` (updates `incomingValue` if the open conflict already exists and the new incoming value differs, per design.md decision 4). `listOpenConflicts(projectId)` (`ALL_ROLES`). `resolveConflict(ctx, conflictId, resolution)` (`WRITE_ROLES`-gated) — `KEPT_MANUAL` just closes the row; `ACCEPTED_INCOMING` writes the incoming value to the work item, calls `recordSyncProvenance`, then closes the row; either way records an `AuditEvent` in the same transaction.
- [ ] 4.5 API routes: `GET /api/projects/[id]/conflicts` (list), `POST /api/conflicts/[id]/resolve` (`WRITE_ROLES`). Extend the work-item detail read path to include each field's `FieldProvenance` for display.
- [ ] 4.6 Tests: a sync that would overwrite a manually-edited field creates a conflict and leaves the field unchanged; a matching incoming value creates no conflict; a field last set by sync (no manual edit) updates normally; resolving `KEPT_MANUAL`/`ACCEPTED_INCOMING` each behave per spec and are audited; a second sync while a conflict is open updates the existing conflict's `incomingValue` rather than creating a duplicate row. Commit: "Add field-level provenance and manual-wins sync conflict resolution"

## Task Group 5: Azure DevOps & GitHub Adapters (4 tasks)

- [ ] 5.1 `src/lib/integrations/azureDevOps.ts`: implements `IntegrationAdapter`, resolving config (`orgUrl`, `project`, `pat`) from `Connector.config` falling back to env vars (same pattern as `jira.ts`'s `resolveConfig`), calling Azure DevOps' Work Items REST API, mapping `id`→`externalId`, `fields['System.Title']`→`title`, `fields['System.Description']`→`description`, `fields['System.State']`→`status`.
- [ ] 5.2 `src/lib/integrations/github.ts`: implements `IntegrationAdapter`, resolving config (`owner`, `repo`, `token`) from `Connector.config`/env, calling the GitHub Issues REST API, mapping `number`→`externalId`, `title`→`title`, `body`→`description`, `state`→`status`.
- [ ] 5.3 Register both in `src/lib/integrations/index.ts`'s `adapters` map (`AZURE_DEVOPS`, `GITHUB`), removing the now-obsolete "no adapter for Azure DevOps" comment. Add `apiToken`/`pat`/`token` fields to `SECRET_FIELDS` for encryption.
- [ ] 5.4 Tests: each adapter maps a representative API response into the correct `FetchedWorkItem[]` shape; each adapter throws a clear configuration error when required config/env is missing (mirroring `jira.ts`'s existing `resolveConfig` test coverage); `getIntegrationAdapter("AZURE_DEVOPS")`/`("GITHUB")` no longer throw "not yet available". Commit: "Add real Azure DevOps and GitHub sync adapters"

## Task Group 6: Idempotent Webhook Intake (4 tasks)

- [ ] 6.1 `src/domain/connector/webhooks.ts`: `receiveWebhook(connectorId, deliveryId, verify)` — inserts into `WebhookDelivery` (`@@unique([connectorId, deliveryId])`); if the insert is a no-op (already exists), returns "duplicate, skip" without enqueueing; otherwise calls `triggerSync` and returns "processed".
- [ ] 6.2 Each adapter gains a webhook verifier: `github.ts` exports `verifyGithubSignature(payload, signatureHeader, secret)` using HMAC-SHA256 + `crypto.timingSafeEqual`; `azureDevOps.ts` exports `verifyAzureDevOpsAuth(request, expectedSecret)` per its Basic-Auth-on-URL scheme. Both documented against their provider's own example payload/signature.
- [ ] 6.3 API routes: `POST /api/webhooks/github/[connectorId]`, `POST /api/webhooks/azure-devops/[connectorId]` — extract the delivery id and signature per adapter, verify, then call `receiveWebhook`; an unverified or unmatched-connector request is rejected (401/404) with no `WebhookDelivery` row created and no sync triggered.
- [ ] 6.4 Tests: a redelivered `deliveryId` triggers exactly one `SyncRun`, not two; a request with an invalid signature is rejected and creates no `WebhookDelivery`/`SyncRun`; a request for a connector with a mismatched or disconnected state is rejected; a genuinely new delivery triggers a sync normally. Commit: "Add idempotent webhook intake for push-capable connectors"

## Task Group 7: UI (4 tasks)

- [ ] 7.1 Project settings: connector configuration form (type, auth, config fields per type, `WRITE_ROLES`), current status (`CONNECTED`/`DISCONNECTED`/`ERROR`), "Sync now" button calling `triggerSync`.
- [ ] 7.2 Sync history view: a project's `SyncRun` list (status, item counts, timing), most recent first, visible to `ALL_ROLES`.
- [ ] 7.3 Work-item detail: a provenance affordance per synced field (source, actor, timestamp) — visible to `ALL_ROLES`, matching the "no fabricated provenance" requirement (omit the affordance entirely for a field with no recorded `FieldProvenance`, don't show a misleading default).
- [ ] 7.4 Conflict review surface: list of a project's open `SyncConflict`s (current vs. incoming value, source), with "Keep manual" / "Accept incoming" actions (`WRITE_ROLES`). Add an Attention Center entry type for open conflicts, per design.md's Attention Center mitigation.

## Task Group 8: End-to-End Test Scenario (1 task)

- [ ] 8.1 Playwright E2E: configure a project's connector (mock/manual-capable adapter for determinism) → trigger a sync → verify work items are created with provenance recorded → manually edit a synced field → trigger a second sync with a differing incoming value for that field → verify the field is unchanged and a conflict appears in the UI → resolve the conflict by keeping the manual value → verify it stays unchanged and the conflict clears → trigger a third sync with a new differing value → resolve by accepting the incoming value → verify the field updates and its provenance now shows sync as the source → verify sync history shows every `SyncRun` with correct item counts. No console errors.

## Task Group 9: Unit Tests for Domain Logic (2 tasks)

- [ ] 9.1 Vitest integration tests (real local Postgres) for every new domain module not already covered inline above: `connector` (backfill, sync-via-job, retry/backoff, provenance, conflict create/resolve, webhook dedup) — cross-cutting `work-item` changes (manual-edit provenance recording) not already exercised by Task Groups 2/4's own test tasks.
- [ ] 9.2 Confirm no regression in the existing Slice 0/1/2/3 domain test suite (`npm test`) — the sync API route's behavior change (now routing through `Connector`/`SyncRun` instead of a direct adapter call) touches any existing test that asserts on the old direct-call shape; update those call sites/assertions, don't leave them silently broken. Commit: "Add comprehensive unit tests for Slice 4 domain logic"

## Task Group 10: Documentation & Verification (1 task)

- [ ] 10.1 Update `docs/PRODUCT_SPEC.md` to reflect Slice 4 (Connector/SyncRun lifecycle, field provenance, conflict resolution, Azure DevOps/GitHub adapters, webhook intake). Update `docs/ROADMAP.md`'s gap register (the connector-framework items covered by this slice, and gap #32's "Jira/integration sync calls still have no retry" note — now closed) and move Slice 4's row to Done, linked to the archived change. Verify no dead code/unused imports (`npm run lint`, `npx tsc --noEmit`). Full verification: `npm run build`, `npm run lint`, `npm test`, `npx playwright test`, `openspec validate --specs`. Archive this OpenSpec change per `docs/ROADMAP.md`'s own stated process, syncing its delta specs into `openspec/specs/`.

---

## Verification Checklist (End-to-End)

Before marking Slice 4 complete:

- [ ] All migrations run without errors; no data loss; every existing `Project` has exactly one backfilled `Connector` before its `integrationType`/`integrationConfig` columns are dropped.
- [ ] A sync never silently overwrites a field a human has edited — it always produces a reviewable conflict instead.
- [ ] Every synced field's provenance (source, externalId/actor, timestamp) is accurate and visible in the UI.
- [ ] A transient adapter failure is retried with backoff via the existing `Job` runtime and eventually succeeds or exhausts cleanly.
- [ ] A redelivered webhook triggers sync effects exactly once, never twice.
- [ ] Azure DevOps and GitHub syncs work against representative real (or realistically mocked) API responses.
- [ ] No connector-specific logic leaked into `src/domain/` — it depends only on the `IntegrationAdapter`/`Connector` abstractions.
- [ ] All Slice 0/1/2/3 functionality continues to work — full existing test suite passes.
- [ ] Build succeeds; lint passes; `tsc --noEmit` clean.
- [ ] E2E scenario passes against the real dev server, real Postgres, and the worker process actually running.
- [ ] `PRODUCT_SPEC.md` and `docs/ROADMAP.md` updated; change archived; specs synced.
