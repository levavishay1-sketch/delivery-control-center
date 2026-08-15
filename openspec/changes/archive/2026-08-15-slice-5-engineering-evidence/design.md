## Context

See proposal.md - Why. Slice 4 already built `Connector` (per-project
integration config + auth), `IntegrationAdapter` (currently `manual.ts`/
`jira.ts`/`azureDevOps.ts`/`github.ts`, all implementing `fetchWorkItems`),
and idempotent webhook intake (`WebhookDelivery` unique on
`[connectorId, deliveryId]`, `src/domain/connector/webhooks.ts`'s
`receiveWebhook`, `src/app/api/webhooks/github/[connectorId]/route.ts`
verifying `X-Hub-Signature-256` via `verifyGithubSignature`).

Today `githubAdapter` only implements `fetchWorkItems` (against GitHub's
Issues API) and the GitHub webhook route only handles the sync-trigger
path (`receiveWebhook` → `triggerSyncFromWebhook`). Neither touches
commits, pull requests, checks, or deployments — that's new in this slice.

`updateWorkItemStatus` (`src/domain/work-item/commands.ts`) validates
transitions via `assertValidTransition` (`src/domain/work-item/status.ts`,
`ALLOWED_TRANSITIONS` state machine) inside a `db.$transaction`, then calls
`recordAuditEvent` in the same transaction.

## Goals / Non-Goals

**Goals:**
- Reuse Slice 4's `Connector`/webhook/adapter infrastructure for GitHub
  evidence data instead of building a parallel fetch/sync mechanism.
- Keep the domain layer's evidence model connector-agnostic: `src/domain/`
  depends on `Repository`/`Commit`/`PullRequest`/`TestRun`/`Build`/
  `Deployment` shapes, never on GitHub's webhook payload shapes directly.
- Make the `APPROVED → COMPLETED` policy check a single, testable function
  the status command calls — not scattered inline conditionals.

**Non-Goals:**
- No auto-detection of work item ↔ PR linking (branch/title parsing) —
  confirmed manual-only for this slice (proposal.md).
- No per-project/per-type configurable completion policy — one fixed
  default policy for every project (proposal.md); configurability is
  Slice 6.
- No non-GitHub evidence source (Jira/Azure DevOps commits or PRs) — this
  slice's `Repository` is GitHub-only; the schema doesn't preclude other
  sources later, but nothing else is implemented now.
- No retroactive re-check of already-`COMPLETED` work items — the policy
  only runs on the transition itself (proposal.md's stated internal
  breaking-change scope).

## Decisions

### 1. New `Repository` model links to a `Connector`, not directly to a `Project`
A `Repository` belongs to a `Connector` (`connectorId` FK) rather than a
bare `projectId`, so linking reuses the connector's existing auth/config
and so `Connector`'s `type = GITHUB` check gates repository linking the
same way it already gates sync. A project's `Connector` can have at most
one `Repository` in this slice (one repo per project, matching how
`Connector` is already one-per-project from Slice 4) — modeled as a
unique `connectorId` on `Repository`, not a full many-to-many.
**Alternative considered**: `projectId` directly on `Repository`, decoupled
from `Connector`. Rejected — would require its own auth/config storage,
duplicating what `Connector.config` already holds.

### 2. Evidence entities are fetched and pushed through the existing GitHub adapter and webhook route, not a new module
`src/lib/integrations/github.ts` gains `fetchRepository`, `fetchCommits`,
`fetchPullRequests`, `fetchCheckRuns` functions alongside the existing
`fetchWorkItems`-driving `githubAdapter` object — these are plain
functions (not part of `IntegrationAdapter`, since that interface is
shaped around work-item sync, not evidence) called directly by the new
evidence sync path. The existing webhook route gains handling for
`push`, `pull_request`, `check_run`/`check_suite`, and
`deployment_status` event types (dispatched by the `X-GitHub-Event`
header) alongside its current sync-trigger-only behavior; each event type
maps to a domain command in `src/domain/evidence/commands.ts` that
upserts the corresponding record.
**Alternative considered**: a wholly separate `EvidenceAdapter` interface
mirroring `IntegrationAdapter`. Rejected as needless ceremony for a
GitHub-only slice — the functions can be promoted into a formal interface
when a second evidence source exists.

### 3. Idempotency reuses `WebhookDelivery`, keyed by the same `[connectorId, deliveryId]` GitHub already sends
GitHub's `X-GitHub-Delivery` header is unique per delivery regardless of
event type, so the existing `WebhookDelivery` dedup insert-before-work
pattern (`receiveWebhook`) covers push/pull_request/check_run/
deployment_status the same way it covers the sync-trigger webhook — no
new dedup table.

### 4. Catch-up fetch runs synchronously inside `linkRepository`, not as a separate `Job`
Unlike `SYNC_PROJECT` (Slice 2's `Job` runtime, used because work-item
sync can be slow/rate-limited across potentially hundreds of items),
linking a repository's initial commit/PR history is bounded (GitHub's
list-commits/list-pulls endpoints, most-recent-N) and a one-time action a
write-capable user is actively waiting on — done inline in the
`linkRepository` command, matching the size/latency trade-off, not
queued through the `Job` runtime. If GitHub rate limits or the history is
large, evidence catches up incrementally anyway via future webhook events,
so a partial/best-effort initial fetch is acceptable.
**Alternative considered**: queue catch-up as a `Job` like `SYNC_PROJECT`.
Rejected for this slice — adds worker-process latency to a UI action with
no benefit, since evidence isn't blocking anything time-sensitive the way
budget/pipeline sync is.

### 5. Completion policy is a single pure function, called from `updateWorkItemStatus`
`src/domain/evidence/completion.ts` exports
`checkCompletionPolicy(workItemId): Promise<{ satisfied: true } | { satisfied: false; missing: string[] }>`.
`assertValidTransition` in `status.ts` stays a pure sync state-machine
check (unchanged); the evidence check is a separate async precondition
`updateWorkItemStatus` runs only when `from === "APPROVED" && to ===
"COMPLETED"`, before the transaction, throwing `ValidationError` naming
what's missing (mirrors how `BudgetExceededError` from Slice 3 is raised
outside the state-machine check).
**Alternative considered**: fold the evidence check into
`ALLOWED_TRANSITIONS`/`assertValidTransition` itself. Rejected —
that function is synchronous and DB-free by design (used in tests without
a DB); the evidence check needs a DB read.

### 6. `CompletionException` is a standalone approval record, not a work-item field
A `CompletionException` row (`workItemId`, `reason`, `approvedByUserId`,
`createdAt`) is created via a dedicated command
(`approveCompletionException`), gated by `WRITE_ROLES`, and
`recordAuditEvent`'d — matching the audit-trail pattern already used for
`BudgetOverride` (Slice 3). `checkCompletionPolicy` treats "an
un-something exception exists for this work item" as satisfying, i.e. its
mere presence (not a boolean flag flipped elsewhere) is the source of
truth — one row per work item is sufficient since nothing in this slice
revokes an exception once approved.

## Risks / Trade-offs

- **GitHub API rate limits during catch-up fetch** → the inline
  `linkRepository` fetch uses `per_page` pagination capped at a bounded
  number of most-recent items (not full history) to keep it fast and
  within a single unauthenticated-adjacent token's rate limit; older
  history simply isn't backfilled, which is acceptable per Decision 4.
- **Webhook event ordering isn't guaranteed by GitHub** (e.g., a
  `check_run` event can arrive before the `pull_request` event for the PR
  it belongs to) → each event handler upserts by GitHub's own stable id
  (commit SHA, PR number, check-run id) and tolerates a not-yet-existing
  parent by creating a minimal placeholder row (e.g., a `PullRequest`
  stub) that a later event fills in, rather than dropping the event.
- **One `Repository` per `Connector` is a real constraint** if a project
  ever needs multiple repos → explicitly deferred; the unique constraint
  is on `connectorId`, easy to relax to many-to-one later without a
  breaking migration (adding rows, not changing shape).

## Migration Plan

Additive-only: new tables (`Repository`, `Commit`, `PullRequest`,
`TestRun`, `Build`, `Deployment`, `Evidence`, `CompletionException`), no
changes to existing tables/columns. No backfill needed — every project
starts with zero linked repositories and catches up only when a
write-capable user explicitly links one. Rollback is a straight migration
`down` (drop the new tables); no data in existing tables is touched, so
there's no equivalent of Slice 4's `Project` column drop to sequence
carefully.
