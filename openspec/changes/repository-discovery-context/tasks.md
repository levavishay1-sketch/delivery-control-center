## Task Group 1: Data model & migration

- [x] Add `DiscoveryStatus` enum (`RUNNING`, `SUCCEEDED`, `FAILED`) to `prisma/schema.prisma`.
- [x] Add `RUN_REPOSITORY_DISCOVERY` to the existing `JobType` enum.
- [x] Add `RepositoryDiscovery` model: `id`, `repositoryId` (FK → `Repository`, `onDelete: Cascade`),
      `version Int`, `status DiscoveryStatus @default(RUNNING)`, `findings Json?`, `aiModel
      String?`, `promptTokens Int?`, `completionTokens Int?`, `costUsd Decimal? @db.Decimal(10,
      4)`, `agentRunId String?` (FK → `AgentRun`, `onDelete: SetNull`), `lastError String?`,
      `triggeredByUserId String` (FK → `User`, `onDelete: Restrict`), `startedAt DateTime
      @default(now())`, `completedAt DateTime?`. `@@unique([repositoryId, version])`,
      `@@index([repositoryId])`.
- [x] Add the reverse relations: `Repository.discoveries RepositoryDiscovery[]`,
      `AgentRun.repositoryDiscoveries RepositoryDiscovery[]`, and a named `User` relation for
      `triggeredByUser` (mirrors `ClarifyQuestion`'s `"ClarifyQuestionAnsweredBy"` pattern).
- [x] Run `prisma migrate dev` to generate and apply the migration; verify it's purely additive
      (no column changes on existing tables).

## Task Group 2: Repository content fetch (GitHub)

- [x] Add `fetchRepositorySnapshot(config: Record<string, unknown> | null)` to
      `src/lib/integrations/github.ts`: resolves `{ owner, repo, token, baseUrl }` via the existing
      `resolveConfig`, fetches the root directory listing
      (`GET /repos/{owner}/{repo}/contents/`), then fetches content (base64-decoded) for any
      `README*` entry and any of `package.json`/`requirements.txt`/`go.mod`/`pom.xml`/`Gemfile`/
      `Cargo.toml` present in that listing. Returns `{ rootListing: string[], readme?: { path:
      string; content: string }, manifests: { path: string; content: string }[] }`. Throws on a
      non-2xx root-listing response; tolerates 404s on individual optional files.
- [x] Unit tests (`github.test.ts`, extending the existing stub-server pattern used for
      `fetchWorkItems`): root listing + README + one manifest present; root listing with no
      README/manifest present (empty optional fields, not an error); root-listing fetch failure
      throws.

## Task Group 3: AI output schema & executor

- [x] Add `repositoryDiscoveryFindingsSchema` to `src/lib/agents/types.ts`, matching design.md's
      findings shape (`purpose`/`stack`/`structure`/`modules`/`apis`/`dataStores`/`testing`/
      `conventions`, each `{ summary: string, evidence: string[] }`, plus `unknowns: string[]`).
      Add `RepositoryDiscoveryContext` (owner, repo, the fetched snapshot) and
      `RepositoryDiscoveryResult` (`findings`, `aiModel`, `promptTokens`, `completionTokens`,
      `costUsd`) interfaces. Add `executeRepositoryDiscovery(context):
      Promise<RepositoryDiscoveryResult>` to the `AgentExecutor` interface.
- [x] Add `config/prompts/repository-discovery.md`: instructions (fetched snapshot content
      templated in) + `<!-- DISCOVERY_FINDINGS -->` marker + output template, following
      `analyze.md`'s existing shape.
- [x] Implement `executeRepositoryDiscovery` in `mockExecutor.ts`: deterministic, built from the
      fetched snapshot directly (e.g. cite `package.json`'s path when present in `manifests`,
      summarize README's first lines for `purpose`), matching the "evidence-grounded, not
      fabricated" property without a real model.
- [x] Implement `executeRepositoryDiscovery` in `claudeExecutor.ts`: fill the new prompt template,
      call Claude, `parseDiscoveryFindings` (structurally identical to the existing
      `parseAnalysisFindings`, validated against `repositoryDiscoveryFindingsSchema`).
- [x] Unit tests for `mockExecutor`'s `executeRepositoryDiscovery` (mirrors existing
      `mockExecutor.test.ts` coverage for ANALYZE: evidence citation when present, honest
      `unknowns` when absent, no claims beyond the root-level snapshot). `claudeExecutor.ts` has no
      existing unit-test coverage anywhere in this codebase (it calls the real Anthropic SDK; only
      `mockExecutor` is unit-tested today) — `parseDiscoveryFindings`'s error paths follow the same
      untested-by-convention pattern as `parseClarifyQuestions`/`parseAnalysisFindings`, not a new
      gap introduced by this slice. `tsc --noEmit` confirms both executors satisfy the extended
      `AgentExecutor` interface.

## Task Group 4: Budget extension

- [x] Add `checkClientBudget(clientId: string): Promise<BudgetCheckResult>` to
      `src/domain/agent/commands.ts`, reusing the existing private `checkBudgetAtScope` helper:
      client tier first, else organization, else `{ allowed: true, scope: null, ... }`. No changes
      to the existing `checkBudget`.
- [x] Add a `repositoryDiscoveries` aggregate leg to `getClientAiCost` and `getOrganizationAiCost`
      in `src/domain/agent/queries.ts` (via `repository.clientId` / `repository.client.organizationId`
      respectively), summed alongside the existing `stages`/`constitutions` legs. Leave
      `getProjectAiCost` unchanged.
- [x] Extend `loadAgentRunWithClientId` (`agent/queries.ts`) with a third resolution leg:
      `run.repositoryDiscoveries[0].repository.clientId`, plus the mid-draft fallback through
      `run.job.payload.repositoryDiscoveryId` (mirrors the existing `stageId`/`constitutionId`
      fallback branches).
- [x] Unit tests: `checkClientBudget` blocks/allows correctly at each tier (client set, client
      unset falling to org, neither set); `getClientAiCost`/`getOrganizationAiCost` include a
      completed Discovery run's cost; `getAgentRunDetail`/`getAgentRunSummary` correctly resolve
      and authorize against a Discovery-run's client.

## Task Group 5: Domain commands & queries

- [x] `src/domain/repository-discovery/commands.ts`:
  - `runRepositoryDiscovery(ctx, repositoryId)`: loads the repository, `requireClientRole(ctx,
    repository.clientId, WRITE_ROLES)`, calls `checkClientBudget` and refuses (matching
    `startPipeline`'s existing refusal shape) if not allowed, computes the next `version` (max
    existing + 1, or 1), creates the `RepositoryDiscovery` row (`status: RUNNING`,
    `triggeredByUserId: ctx.userId`) and enqueues a `RUN_REPOSITORY_DISCOVERY` job
    (`idempotencyKey: repository-discovery-${discovery.id}`) in the same transaction, and records
    an audit event.
  - `completeRepositoryDiscovery(discoveryId, result, agentRunId)`: in a transaction, updates the
    `RepositoryDiscovery` row (`findings`, `status: SUCCEEDED`, `aiModel`/token/cost cache,
    `completedAt`, `agentRunId`), calls `completeAgentRun`, records an audit event.
  - `revertRepositoryDiscoveryFailure(discoveryId, error, jobId)`: in a transaction, marks the
    `RepositoryDiscovery` `FAILED` with `lastError`/`completedAt`, marks the owning `AgentRun`
    failed (`exhausted: true`), records an audit event.
  - `getRepositoryDiscoveryForRun(discoveryId)`: worker-side loader (discovery + repository +
    repository's connector, for the fetch step).
  - Implementation note: `BudgetExceededError`'s `projectId` constructor param was widened to
    `string | undefined` (was required `string`) — Discovery has no Project to pass. Existing
    callers (`draftConstitution`/`draftStage`) are unaffected since they still pass a real
    `projectId`; the one JSON-serializing consumer (`.../constitution/draft/route.ts`) already
    tolerates `undefined` becoming absent in the response.
- [x] `src/domain/repository-discovery/queries.ts`:
  - `getRepositoryContext(ctx, repositoryId)`: `requireClientRole(ctx, repository.clientId,
    ALL_ROLES)`, returns the latest `SUCCEEDED` discovery's `findings` + `completedAt`, or `null`
    if none.
  - `listRepositoryDiscoveries(ctx, repositoryId)`: same authz, every version newest-first
    (status, cost, timestamps — not full findings, matching the run-summary-vs-detail pattern
    elsewhere).
- [x] Unit tests: trigger creates a versioned row + enqueues a job + audits; trigger refused for a
      read-only user; trigger refused over budget; a second trigger creates version 2, not
      overwriting version 1; complete/fail transitions update state and audit correctly;
      `getRepositoryContext` returns the latest succeeded version's findings and `null` when none
      exist yet. Full suite (333 tests, 42 files) green — no regressions.

## Task Group 6: Job runtime wiring

- [x] `worker.ts`: add `handleRunRepositoryDiscoveryJob(payload, jobId)` — loads the discovery via
      `getRepositoryDiscoveryForRun`, decrypts the repository's connector config, calls
      `fetchRepositorySnapshot`, resolves `resolveDefaultAgentId()`, `startAgentRun(agentId,
      jobId)`, calls `getAgentExecutor().executeRepositoryDiscovery(...)`, then
      `completeRepositoryDiscovery(discoveryId, result, run.id)`. Add
      `handleRunRepositoryDiscoveryExhausted` calling `revertRepositoryDiscoveryFailure`. Register
      both in the `handlers` map under `RUN_REPOSITORY_DISCOVERY`.
- [x] Test coverage: this codebase has no test file for `worker.ts` itself anywhere (its handler
      functions aren't exported) — every existing slice instead tests the worker-side domain
      functions directly with a comment noting what the real handler does ("Simulates what
      worker.ts's X handler does, without running the poll loop" — see
      `constitution/commands.test.ts`, `pipeline/commands.test.ts`). Group 5's
      `repository-discovery/commands.test.ts` already follows this exact convention
      (`runDiscoveryJob`). `npm run build` confirms `worker.ts` itself compiles and type-checks
      against the new handler.

## Task Group 7: API routes

- [x] `POST /api/repositories/[id]/discovery`: calls `runRepositoryDiscovery`, mirroring
      `POST /api/projects/[id]/constitution/draft`'s exact error-handling shape (`BudgetExceededError`
      -> structured 409 body, other `DomainError` -> its own status, else rethrow). 200 with the
      created discovery row on success.
- [x] `GET /api/repositories/[id]/discovery`: calls `listRepositoryDiscoveries`, for the run-history
      list's client-side refresh after triggering (mirrors the existing `GET` routes this project
      already has for drawer/history data, e.g. `work-items/[id]/audit`).
- [x] Ran `npx next typegen` to generate `RouteContext<"/api/repositories/[id]/discovery">` for the
      new route; `tsc --noEmit` clean.
- [x] Route test coverage: this codebase unit-tests exactly one route (`locale/route.test.ts`) —
      every other route (including Slice 12's Client CRUD routes and Slice 3's budget-override
      routes) is covered by Playwright E2E instead, not a per-route unit test. Following that
      convention, success/forbidden/budget-refused coverage for this route lives in Group 8's E2E
      spec rather than a new, inconsistent unit-test pattern.

## Task Group 8: UI

- [ ] New `/repositories/[id]/page.tsx`: repository header (owner/name), a Discovery panel showing
      `getRepositoryContext`'s current summary (each field's `summary` + an evidence list) with a
      completed-at label, or an empty state with a "Run Discovery" button when none exists yet; a
      run-history list from `listRepositoryDiscoveries` (status badges reusing `StatusBadge`,
      cost, timestamps). Reuses Slice 7/10's `Panel`/`Row`/`Button`/`StatusBadge` primitives and
      Slice 11's `InfoTooltip` for the "context can go stale" explanation.
- [ ] "Run Discovery" button: a small `"use client"` island posting to the new route and
      `router.refresh()`, following the existing mutation-island pattern used elsewhere (e.g.
      `RepositoryLinkForm`).
- [ ] Wire the client detail view's existing repository rows (Slice 12) to link to
      `/repositories/[id]` — no other change to that page.
- [ ] Loading/empty/error/permission-denied states per this project's Definition of Done.
- [ ] E2E spec: view a repository with no Discovery yet (empty state, button visible to a
      write-capable user, hidden/disabled for a read-only user) → trigger a run → see it complete
      (against the mock executor) → findings and evidence visible, run appears in history → trigger
      again → a second version appears without losing the first.

## Task Group 9: Documentation & verification

- [ ] Update `docs/ROADMAP.md`'s Slice 14 row to **Done**, linking this archived change.
- [ ] `npm run build`, `npm run lint`, full unit + E2E suite green.
- [ ] Live verification: seed a real (or stubbed-GitHub) repository, trigger Discovery through the
      UI, confirm the findings render with evidence citations and the run appears in the audit
      trail and the client's AI cost total; confirm a budget-exceeded client refuses the trigger
      with a clear error.
