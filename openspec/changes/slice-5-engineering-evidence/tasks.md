## 1. Data model & migrations

- [x] 1.1 Add `Repository`, `Commit`, `PullRequest`, `TestRun`, `Build`, `Deployment`, `Evidence`, `CompletionException` models to `prisma/schema.prisma` (`Repository.connectorId` unique FK to `Connector`; `Commit`/`PullRequest` unique on `[repositoryId, externalId or sha]`; `TestRun`/`Build`/`Deployment` FK to `PullRequest` or `Commit` as appropriate; `Evidence` unique on `[workItemId, pullRequestId]`; `CompletionException` FK to `WorkItem` and `approvedByUserId` FK to `User`).
- [x] 1.2 Generate and apply the migration (`npx prisma migrate deploy` per the project's non-interactive-migration workaround); run `npx prisma generate`.
- [x] 1.3 Restart the dev server and worker so the regenerated Prisma Client is picked up (per the project's stale-client gotcha). (No dev server/worker was running; nothing to restart.)

## 2. GitHub adapter extension

- [x] 2.1 Add `fetchRepository`, `fetchCommits`, `fetchPullRequests`, `fetchCheckRuns` functions to `src/lib/integrations/github.ts`, using the existing `resolveConfig`/token pattern, each paginated and capped per design.md decision 4/risk 1.
- [x] 2.2 Unit test each function against a stubbed `fetch` (mirroring the existing `github.test.ts` pattern).

## 3. Evidence domain logic — repositories & catch-up fetch

- [x] 3.1 Create `src/domain/evidence/commands.ts`: `linkRepository(ctx, projectId, config)` — WRITE_ROLES-gated, creates the `Repository` row against the project's GitHub `Connector`, then runs the bounded catch-up fetch (2.1's functions) inline, upserting `Commit`/`PullRequest`/`TestRun` rows; `unlinkRepository(ctx, repositoryId)`.
- [x] 3.2 Create `src/domain/evidence/queries.ts`: `getRepositoryForProject`, `listCommitsForRepository`, `listPullRequestsForRepository`.
- [x] 3.3 Unit tests for `linkRepository`/`unlinkRepository` against real Postgres, mocking `src/lib/integrations/github.ts`'s new fetch functions per the project's established `vi.mock` convention.

## 4. Webhook event handling

- [x] 4.1 Extend `src/app/api/webhooks/github/[connectorId]/route.ts` to branch on `X-GitHub-Event` (`push`, `pull_request`, `check_run`, `deployment_status`) in addition to the existing sync-trigger path, after the same signature verification and `WebhookDelivery` dedup insert. (`check_suite` deferred — GitHub's `check_run` event alone covers this slice's test-run tracking; `receiveWebhook` gained a `triggerSync` flag so evidence-only event types skip the SYNC_PROJECT trigger.)
- [x] 4.2 Add `recordPushEvent`, `recordPullRequestEvent`, `recordCheckRunEvent`, `recordDeploymentStatusEvent` to `src/domain/evidence/commands.ts` — each upserts by GitHub's stable id, tolerating a not-yet-existing parent row per design.md risk 2 (create a minimal placeholder, let a later event fill it in).
- [x] 4.3 Unit tests for each event handler, including out-of-order arrival (check_run before its pull_request).

## 5. Manual work item ↔ evidence linking

- [x] 5.1 Add `linkEvidence(ctx, workItemId, pullRequestId)` / `unlinkEvidence(ctx, evidenceId)` to `src/domain/evidence/commands.ts` — WRITE_ROLES-gated, creates/removes the `Evidence` row, `recordAuditEvent`'d.
- [x] 5.2 Add `getEvidenceForWorkItem(workItemId)` to `src/domain/evidence/queries.ts` — linked pull requests with their commits and current CI status, and associated test runs.
- [x] 5.3 Unit tests for link/unlink, including the "unlinking removes the record" scenario.

## 6. Evidence-driven completion policy

- [x] 6.1 Create `src/domain/evidence/completion.ts`: `checkCompletionPolicy(workItemId)` — returns satisfied or a list of missing items (no linked PR / PR not merged / tests not passing), checking for an approved `CompletionException` as an alternate satisfying condition.
- [x] 6.2 Add `approveCompletionException(ctx, workItemId, reason)` to `src/domain/evidence/commands.ts` — WRITE_ROLES-gated, required `reason`, `recordAuditEvent`'d.
- [x] 6.3 Wire `checkCompletionPolicy` into `updateWorkItemStatus` (`src/domain/work-item/commands.ts`): before the transaction, when `from === "APPROVED" && to === "COMPLETED"`, call it and throw `ValidationError` naming what's missing if unsatisfied.
- [x] 6.4 Unit tests: completing with qualifying evidence succeeds; completing without evidence and without an exception is rejected with a descriptive error; completing without evidence but with an approved exception succeeds. One pre-existing `commands.test.ts` test ("rejects COMPLETED as a source") needed a one-line update (approve an exception before completing) since it wasn't testing the evidence policy itself, only terminal-state rejection; every other existing transition test passed unmodified. Full suite: 253/253 passing.

## 7. API routes

- [x] 7.1 `POST /api/projects/[id]/repository` (link), `DELETE /api/projects/[id]/repository` (unlink).
- [x] 7.2 `POST /api/work-items/[id]/evidence` (link a PR), `DELETE /api/evidence/[id]` (unlink).
- [x] 7.3 `POST /api/work-items/[id]/completion-exception` (approve an exception).
- [x] 7.4 `GET /api/work-items/[id]/evidence` (evidence + policy state, for the Evidence tab). (Combined into the same route file as 7.2's POST, matching the project's convention of one route.ts per resource path with multiple HTTP method exports.)

## 8. UI — Code & Changes, Tests, Evidence tabs

- [ ] 8.1 Replace the "Coming soon" Code & Changes tab placeholder in `src/app/work-items/[id]/360/page.tsx` with a real tab listing linked pull requests, their commits, and CI status; empty state plus a write-capable "link a pull request" action.
- [ ] 8.2 Replace the Tests tab placeholder with a list of test runs associated with the work item's linked pull requests.
- [ ] 8.3 Replace the Evidence tab placeholder with the completion-policy state (satisfied / what's missing, in plain language) and, for a write-capable role, the link/unlink and exception-approval actions.
- [ ] 8.4 New client components as needed (e.g. `EvidenceLinkForm.tsx`, `CompletionExceptionForm.tsx`), following the project's server-reads/client-mutates-via-fetch convention — map any Prisma row with `Decimal`/non-plain fields to a plain object before passing into a `"use client"` component (per Slice 4's found RSC-boundary bug).

## 9. E2E test scenario

- [ ] 9.1 Write `e2e/slice5-engineering-evidence.spec.ts`: link a repository (stub GitHub API server per Slice 4's `startStubJiraServer` pattern), receive a webhook event recording a PR and passing test run, manually link that PR's work item, attempt `APPROVED → COMPLETED` and see it succeed; separately, attempt the same transition on a work item with no evidence and see it rejected, then approve a `CompletionException` and see it then succeed.

## 10. Documentation & verification

- [ ] 10.1 Update `docs/PRODUCT_SPEC.md`: Code & Changes/Tests/Evidence tabs move from "Coming soon" to implemented; refresh "Current capabilities"/"Missing capabilities" lists; add a Slice 5 section.
- [ ] 10.2 Update `docs/ROADMAP.md`: mark the relevant gap-register items closed, Slice 5 row → Done with archive link.
- [ ] 10.3 Run build + lint + `tsc --noEmit` + full unit test suite + the new E2E test; live-check both the webhook path (a real signed request) and the completion-policy rejection/approval path against the running dev server, per the project's verification standard.
