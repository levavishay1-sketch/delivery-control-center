## Context

See proposal.md for motivation. Relevant current state:

- `Repository` (Slice 12, `schema.prisma:868`) is client-owned (`clientId`), keeps its original
  `connectorId` (a project's GitHub `Connector`) for auth/config — `decryptIntegrationConfig`
  against `connector.config` yields `{ owner, repo, token, baseUrl }`, exactly what
  `linkRepository` (`src/domain/evidence/commands.ts`) already uses.
- `Constitution` (`schema.prisma:396`) is this codebase's closest existing precedent for
  "versioned, AI-produced artifact, drafted via the Job runtime, gated by budget, cost cached
  alongside an `agentRunId` FK" — `RepositoryDiscovery` follows the same shape.
- `Job`/`Agent`/`AgentRun` (Slice 2/3) are the durable execution runtime: `enqueueJob` writes a row
  in the same transaction as the state change that requested it; `worker.ts` polls, dispatches by
  `JobType` to a registered handler, and on final failure calls that handler's `onExhausted`.
  `startAgentRun`/`completeAgentRun`/`failAgentRun` (`src/domain/agent/commands.ts`) are reused
  verbatim.
- `checkBudget(clientId, projectId)` (`src/domain/agent/commands.ts:158`) always requires a
  `projectId` — it resolves project → client → organization. Discovery has no `Project`, so this
  function cannot be called as-is.
- `getClientAiCost`/`getOrganizationAiCost` (`src/domain/agent/queries.ts`) aggregate `AgentRun`
  cost by traversing `stageVersions`/`constitutions` relations — a Discovery `AgentRun` needs a
  third relation added to both aggregates, or client/org-level budget checks would silently
  undercount Discovery spend.
- `AgentExecutor` (`src/lib/agents/types.ts`) is the seam between the worker and both
  `mockExecutor`/`claudeExecutor` — `executeStage`/`executeConstitution` are its only two methods
  today.
- No code anywhere fetches a repository's file contents from GitHub — `src/lib/integrations/
  github.ts` only fetches issues (work-item sync). Evidence-gathering for Discovery is new.

## Goals / Non-Goals

**Goals:**
- A repository has a persistent, versioned, evidence-cited structured understanding, produced by
  an explicit user action.
- Every claim in that understanding is traceable to something actually fetched from the
  repository — not a model hallucination presented as fact.
- Reuses the existing Job/Agent/AgentRun execution discipline exactly — no second execution path.
- A repository-scoped AI action respects budget the same way a project-scoped one does, extended
  to a scope with no project tier.

**Non-Goals** (see proposal.md and `docs/ROADMAP.md`'s Slice 14 status block for the full
reasoning):
- System Context / cross-repository relationship discovery and reconciliation (source spec
  §12-13) — needs at least two Discovery-covered repositories and its own reconciliation
  mechanism.
- Context Maintenance (source spec §11) — detecting a source change and automatically
  re-analyzing. This change is a manually-triggered, point-in-time snapshot only; no
  webhook-triggered or change-watching re-run.
- Deep, multi-level repository tree crawling. This change fetches the root directory listing, the
  README, and well-known dependency-manifest files only — a single-level, bounded fetch. A full
  recursive clone/crawl is a `Sandboxed coding runtime` concern (gap-analysis item #30), out of
  scope for the whole product today, not just this slice.
- A `Constitution` row. The old blueprint's "baseline Constitution for the existing codebase"
  framing is superseded — `Constitution` (Slice 2) is Project-scoped; Discovery is
  Repository-scoped with no Project involved. `RepositoryDiscovery` is its own record, not a
  `Constitution`.
- Per-operation model selection (Decision 9's eventual scope, `docs/roadmap-sources/
  2026-08-17-core-product-definition-gap-analysis.md` Part 2). This change routes Discovery to the
  registry's current default agent only, the same as `executeConstitution` does today — no new
  per-Discovery routing config.
- Editing or annotating Discovery findings by hand. A finding is what the AI run produced; a wrong
  finding is fixed by running Discovery again, not by hand-editing a version.

## Decisions

**`RepositoryDiscovery` is a new top-level model, not a JSON column on `Repository`.**
Mirrors `Constitution`'s shape exactly: `id`, `repositoryId`, `version Int`, `status
DiscoveryStatus`, `findings Json?` (the validated structured output), `aiModel`/`promptTokens`/
`completionTokens`/`costUsd` (cache, same pattern as `Constitution`/`StageVersion`), nullable
`agentRunId` FK, `lastError String?`, `triggeredByUserId`, `startedAt`, `completedAt`.
`@@unique([repositoryId, version])`. A JSON column on `Repository` could not represent version
history (the whole point of "prior versions stay retrievable" per the spec delta) without
reinventing an array-of-versions structure inside one JSON blob — a real table gets that for free
and matches every other versioned-artifact precedent in this codebase.

**`RepositoryContext` is a query, not a table.** `getRepositoryContext(repositoryId)` returns the
latest `SUCCEEDED` `RepositoryDiscovery`'s `findings` plus its `completedAt` (the "as of" label the
spec delta requires) — a `findMany` ordered by `version desc`, `take: 1`, filtered to `status:
"SUCCEEDED"`. No separate `RepositoryContext` table: it would either duplicate the latest
`RepositoryDiscovery` row's data (a sync-drift risk with zero benefit) or be an empty wrapper
around the same query this function already is.

**Findings schema, validated by Zod before every write** (mirrors `analysisFindingsSchema`'s
discipline exactly):
```
{
  purpose:     { summary: string, evidence: string[] },
  stack:       { summary: string, evidence: string[] },
  structure:   { summary: string, evidence: string[] },
  modules:     { summary: string, evidence: string[] },
  apis:        { summary: string, evidence: string[] },
  dataStores:  { summary: string, evidence: string[] },
  testing:     { summary: string, evidence: string[] },
  conventions: { summary: string, evidence: string[] },
  unknowns:    string[]
}
```
Each `evidence` entry is a file path the fetch step actually retrieved (see below) — the AI is
instructed to cite only from what it was given, and a citation to a path outside the fetched set
fails validation, forcing a retry rather than silently accepting an ungrounded claim.

**Evidence gathering is a new, bounded GitHub fetch — one root listing plus a fixed set of
well-known files.** `fetchRepositorySnapshot(config)` in `src/lib/integrations/github.ts`:
1. `GET /repos/{owner}/{repo}/contents/` → root directory listing (name + type per entry).
2. If a `README*` entry exists in that listing, `GET` its content, base64-decoded.
3. For each of `package.json`, `requirements.txt`, `go.mod`, `pom.xml`, `Gemfile`, `Cargo.toml`
   present in the root listing, `GET` its content, base64-decoded.
Returns `{ rootListing: string[], readme?: { path: string; content: string }, manifests: {
path: string; content: string }[] }`. A 404 on an individual optional file is not an error (most
repos have at most one or two manifest types); a non-2xx on the root listing itself is — matches
`githubAdapter.fetchWorkItems`'s existing error-throwing convention.

**`AgentExecutor` gains `executeRepositoryDiscovery`, following the exact ANALYZE precedent.**
Both `mockExecutor` and `claudeExecutor` already have a working pattern for "structured JSON
after a marker, Zod-validated" (`ANALYZE_FINDINGS_MARKER` / `analysisFindingsSchema`). Discovery
reuses it verbatim: a new `config/prompts/repository-discovery.md` template (instructions +
`<!-- DISCOVERY_FINDINGS -->` marker + output template), a new `repositoryDiscoveryFindingsSchema`
in `src/lib/agents/types.ts`, and a new `parseDiscoveryFindings` in `claudeExecutor.ts` structurally
identical to `parseAnalysisFindings`. `mockExecutor`'s version fills the template deterministically
from the fetched snapshot (e.g. citing `package.json` when present in `manifests`) rather than
guessing — keeping the "evidence-grounded, not fabricated" property true even without a real model.

**A new `JobType.RUN_REPOSITORY_DISCOVERY`, dispatched in `worker.ts` alongside the existing
three.** `handleRunRepositoryDiscoveryJob(payload, jobId)`: loads the `RepositoryDiscovery` +
`Repository` + its `connector`'s decrypted config, calls `fetchRepositorySnapshot`, resolves
`resolveDefaultAgentId()`, `startAgentRun`, calls `executeRepositoryDiscovery`, then
`completeRepositoryDiscovery(discoveryId, result, run.id)`. `onExhausted:
revertRepositoryDiscoveryFailure` mirrors `revertConstitutionDraftFailure`'s transaction shape
(mark the `RepositoryDiscovery` `FAILED` with `lastError`/`completedAt`, mark the `AgentRun`
`FAILED` with `exhausted: true`, in one transaction).

**Budget: a new `checkClientBudget(clientId)`, not a reshaped `checkBudget`.** Adding an optional
`projectId` to the existing `checkBudget` and special-casing "no project" inside it would tangle
two different scope-resolution orders (project→client→org vs. client→org) into one function's
control flow. Instead, `checkClientBudget(clientId)` in `src/domain/agent/commands.ts` reuses the
existing private `checkBudgetAtScope` helper directly — client tier first, else organization,
else unbounded — with the exact same `BudgetCheckResult` shape and the same
`claimBudgetOverride`/`approveBudgetOverride` machinery (an override approved at `clientId` scope
already works for this, since `approveBudgetOverride` already accepts a bare `clientId`).
`checkBudget` itself is unchanged; `runRepositoryDiscovery` calls the new function, `startPipeline`
et al. keep calling the old one.

**`getClientAiCost`/`getOrganizationAiCost` gain a third aggregate leg.** Both add a
`db.agentRun.aggregate({ where: { repositoryDiscoveries: { some: { repository: { clientId } } } }
})` (client version) / `{ ...clientId: undefined, ...organizationId }` (org version, through
`repository.client.organizationId`), summed alongside the existing `stages`/`constitutions` legs —
same pattern, third relation. `getProjectAiCost` is untouched (Discovery has no `projectId` to
filter by, by design).

**`loadAgentRunWithClientId` (agent/queries.ts) gains a third resolution path.** For
permissioned run-detail visibility (existing `agent-run-tracking` requirement, unmodified — this
is an implementation extension, not a new requirement), a Discovery `AgentRun`'s owning client is
resolved via `run.repositoryDiscoveries[0].repository.clientId`, same optional-chain pattern as the
existing `stageVersions[0]`/`constitutions[0]` legs, including the mid-draft fallback through
`run.job.payload.repositoryDiscoveryId`.

**Repository detail page is a new route, `/repositories/[id]`, not a modal or inline expansion on
the client detail view.** Matches this product's existing convention (every major surface is a
real route — Slice 12's own design.md made the same call for the Clients hub itself) and gives the
Discovery panel (current context + run history + trigger button) enough room without cramming it
into the client detail view's repository row. The client detail view's existing repository rows
(Slice 12) become links to this page — a UI wiring change, not a `clients-hub` requirement change
(that capability's requirements about what a client detail view shows are unaffected).

## Risks / Trade-offs

- **Evidence quality is shallow** (root + README + manifests only, no subdirectory crawl) →
  Mitigation: this is a disclosed Non-Goal, not a silent limitation; the `unknowns` field exists
  precisely to make this honest instead of overclaiming, and the UI's "as of" / informational
  framing (spec requirement) reinforces it further.
- **A large README or manifest could push prompt size/cost up unpredictably** → Mitigation: same
  cost/budget gate as every other AI action already covers this (a Discovery run that turns out
  expensive still counts against the client's budget like any other run); no separate truncation
  logic is added in this change, matching the "don't add validation for scenarios that can't
  happen" principle — if this becomes a real problem, it is exactly the kind of thing a follow-up
  slice's real usage data should inform, not something to guess a limit for now.
- **A repository's originating connector token could be revoked or expired between link time and
  a Discovery trigger** → Mitigation: `fetchRepositorySnapshot` surfaces the GitHub API's own error
  (matches `githubAdapter.fetchWorkItems`'s existing convention), the Job runtime retries with
  backoff, and permanent failure lands as a normal `FAILED` `RepositoryDiscovery` with the error
  visible — no new failure-handling mechanism needed.
- **Two independent budget-check code paths** (`checkBudget` vs. `checkClientBudget`) could drift
  if the client/org fallback logic ever changes → Mitigation: both call the same private
  `checkBudgetAtScope` helper for the tiers they share (client, organization) — only the "does a
  project tier exist" branch differs, and that branch is a single `if` at the top of each public
  function, not duplicated resolution logic.

## Migration Plan

1. Schema migration: add `RepositoryDiscovery` model, `DiscoveryStatus` enum, `RUN_REPOSITORY_DISCOVERY`
   value on `JobType`. Purely additive — no existing table or column changes, no backfill needed
   (a new model starts with zero rows).
2. Application code: `fetchRepositorySnapshot` (github.ts); `repositoryDiscoveryFindingsSchema` +
   `executeRepositoryDiscovery` (types.ts, mockExecutor.ts, claudeExecutor.ts) +
   `config/prompts/repository-discovery.md`; `checkClientBudget` (agent/commands.ts);
   `getClientAiCost`/`getOrganizationAiCost` third aggregate leg; `src/domain/repository-discovery/`
   (commands + queries); `worker.ts` handler; `POST /api/repositories/[id]/discovery` route;
   `/repositories/[id]` page + client detail view link-through.

No rollback complexity beyond the standard `prisma migrate` down path — nothing destructive at any
step.
