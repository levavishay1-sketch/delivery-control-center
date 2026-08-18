## Roadmap Source

This change implements `docs/ROADMAP.md`'s Slice 5 row ("Engineering
evidence"), scoped from `docs/roadmap-sources/2026-08-14-gap-analysis-full.md`
§5 "Slice 5":

> - Repository, branch, commit, pull request, test run, build, deployment
>   entities.
> - Code & Changes and Tests tabs on the 360° record — trace **work item
>   → code change**.
> - **`Evidence`** entity and **evidence-driven completion**: a work item
>   completes only when all mandatory evidence is present, or an exception
>   is explicitly approved and recorded. Status alone must never mean
>   "done".

Two decisions the source doesn't specify were confirmed with the user
before scoping this change:

1. **Work item ↔ PR/commit linking is manual in this slice** — a
   write-capable user explicitly links a pull request or commit to a work
   item. No PR-title/branch-name parsing convention is invented; the
   product's own "automatic first, manual always available" principle
   (source §6) is satisfied from the manual side here, auto-detection can
   be added later without a breaking change.
2. **Evidence-driven completion uses one fixed default policy for this
   slice**: a work item needs at least one linked, merged pull request and
   that PR's latest test run passing before it can move to `COMPLETED` —
   or an explicitly human-approved exception recorded in its place.
   Per-project/per-type configurable policy is Slice 6's Configuration
   Center territory, not pulled forward here.

## Why

Work-item status today (`WorkStatus`) is a human-asserted claim with
nothing underneath it — a work item can be marked `COMPLETED` with zero
evidence that any code was ever written, reviewed, or tested. The
product's own stated non-negotiable is "status alone must never mean
'done'" (source §6), and the 360° Record's Code/Tests/Evidence tabs are
already wired up as honest "Coming soon" placeholders (`work-items/[id]/
360/page.tsx`) waiting for exactly this. Slice 4 built the connector/
adapter/webhook infrastructure (`Connector`, `IntegrationAdapter`,
idempotent webhook intake) this slice can reuse directly for GitHub commit/
PR/CI data, rather than inventing a second fetch-and-sync mechanism.

## What Changes

- Add `Repository` (one per project's linked GitHub repo, via its existing
  `Connector`), `Commit`, `PullRequest`, `TestRun`, `Build`, `Deployment`
  entities — populated by GitHub webhook events (reusing Slice 4's
  idempotent `WebhookDelivery` dedup pattern) and, for the initial/
  catch-up fetch, the existing GitHub `IntegrationAdapter` extended with
  the calls these need (repo metadata, commits, PRs, check-runs/statuses).
- Add `Evidence`: a work item's link to a `PullRequest` (or, later, other
  evidence types) — created by an explicit manual-link action, not
  inferred.
- **Evidence-driven completion**: `updateWorkItemStatus`'s transition to
  `COMPLETED` now checks the fixed default policy above; refuses with a
  clear error naming what's missing unless satisfied, or an approved
  `CompletionException` exists for this work item instead.
- **BREAKING** (internal only, no external API): a work item that could
  previously reach `COMPLETED` from `APPROVED` on status alone now needs
  either qualifying evidence or an explicit exception — existing rows
  already `COMPLETED` are untouched (the check only runs on the
  transition itself, not retroactively).
- 360° Record: **Code & Changes** tab lists linked commits/PRs with their
  CI status; **Tests** tab lists test runs; **Evidence** tab shows the
  completion policy's current state (satisfied / missing what) and, for a
  write-capable role, the manual-link action and the exception-approval
  action.
- No connector-specific logic in `src/domain/` — evidence entities are
  populated by GitHub's adapter and webhook today, but the domain layer
  depends only on the `Repository`/`Commit`/`PullRequest`/etc. shapes,
  never on GitHub's own API shapes directly (matching Slice 4's own
  architecture principle).

## Capabilities

### New Capabilities
- `engineering-evidence`: `Repository`/`Commit`/`PullRequest`/`TestRun`/
  `Build`/`Deployment` entities, populated via GitHub webhook + the
  existing GitHub adapter; manual work-item-to-PR linking (`Evidence`);
  the Code & Changes and Tests tabs on the 360° Record.
- `evidence-driven-completion`: the fixed default completion policy, the
  `COMPLETED` transition check, and the human-approved exception path
  (`CompletionException`) when qualifying evidence is missing.

### Modified Capabilities
- `work-item-model` (or the exact existing path under `openspec/specs/` —
  confirmed as `work-item-model` in this repo): the `APPROVED` →
  `COMPLETED` transition requirement gains the evidence-or-exception
  precondition described above; every other transition is unchanged.

## Impact

- **Schema**: new `Repository`, `Commit`, `PullRequest`, `TestRun`,
  `Build`, `Deployment`, `Evidence`, `CompletionException` models; a
  `Repository` links to a project's `Connector` (reusing Slice 4's
  webhook-delivery/dedup infrastructure per-repository).
- **Domain**: new `src/domain/evidence/` (commands/queries), a change to
  `src/domain/work-item/status.ts`'s `assertValidTransition` (or its
  caller in `commands.ts`) to check the completion policy on
  `APPROVED → COMPLETED`.
- **Adapters**: `src/lib/integrations/github.ts` gains repo/commit/PR/
  check-run fetch methods (or a sibling module, decided in design.md);
  the GitHub webhook route (`src/app/api/webhooks/github/[connectorId]`)
  extended to handle push/pull_request/check_run/deployment_status event
  types alongside the existing sync trigger.
- **API**: routes for linking/unlinking evidence, listing a work item's
  evidence, and approving a completion exception.
- **UI**: 360° Record's Code & Changes and Tests tabs become real; the
  Evidence tab shows policy state and (write-capable) actions.
