## Roadmap Source

Implements Slice 14 of `docs/ROADMAP.md` ("Repository Discovery & Context (bootstrap on connect)"
— re-scoped 2026-08-18), sourced from `docs/roadmap-sources/2026-08-17-core-product-definition.md`
§8-13 and reconciled in `docs/roadmap-sources/2026-08-17-core-product-definition-gap-analysis.md`
(Part 1's §8-13 section, Part 3's Slice 14 row):

> "Repository Discovery (targeted, persistent understanding: purpose/stack/structure/modules/
> domains/APIs/data stores/testing/conventions/unknowns/evidence)" — currently Missing (zero
> matches for `RepositoryDiscovery` anywhere in code).

> "Repository Context (persistent, navigational, not a substitute for source verification)" —
> currently Missing (zero matches for `RepositoryContext` anywhere in code).

`docs/ROADMAP.md`'s Slice 14 status block (added 2026-08-18) bounds this change's scope
explicitly: a single-repository, explicitly-triggered Discovery pass reusing the existing
`Agent`/`AgentRun`/`Job` execution discipline, with System Context/Reconciliation (source §12-13,
cross-repository relationships) and Context Maintenance (source §11, change-triggered
re-analysis) deferred to a later slice.

## Why

Every repository this product knows about today (`Repository`, Slice 12) is an opaque row —
`owner`/`name`/`externalId` and its commit/PR/test-run history, nothing about what it actually
*is*: its purpose, stack, structure, or conventions. A user (or a future AI operation reasoning
about "which repositories are relevant to this work") has no persistent, product-native answer to
"what is this repository" short of opening it themselves. The source specification names this gap
directly as Repository Discovery/Context, and the current 21-slice roadmap has never scoped it —
the old blueprint's Slice 14 was a one-paragraph "check SDD status and bootstrap a Constitution"
sketch that the more detailed source spec supersedes (see the gap-analysis's Slice 14 row).

## What Changes

- New `RepositoryDiscovery` record: one versioned, AI-produced analysis per `Repository` —
  purpose, stack, structure, modules/domains, APIs, data stores, testing approach, and
  conventions, each backed by `evidence` (the actual file paths fetched and read to support that
  claim), plus an explicit `unknowns` list for what evidence couldn't establish. Never overwritten
  in place — a new run creates a new version, prior versions stay retrievable.
- A real, if bounded, evidence base: fetches a repository's root directory listing, README, and
  any present dependency-manifest file (`package.json`, `requirements.txt`, `go.mod`, `pom.xml`,
  `Gemfile`, `Cargo.toml`) via the GitHub Contents API, using the repository's existing GitHub
  connector credentials. Deeper, multi-level tree crawling is explicitly out of scope for this
  change (see design.md's Non-Goals) — this is intentionally the same honesty trade-off the
  product already makes elsewhere (e.g. `IMPLEMENT` stays an AI-drafted document, not real code
  execution): claims beyond what this shallow fetch can support belong in `unknowns`, not
  fabricated.
- `RepositoryContext`: the current, queryable view of a repository's latest successful Discovery —
  no new table, a query over `RepositoryDiscovery` (see design.md). Surfaced on a new repository
  detail page, reachable from the client detail view, labeled with when it ran and never presented
  as a substitute for reading live source.
- An explicit "Run Discovery" action, gated the same way this codebase gates every other
  AI-cost-incurring action: write-capable role on the owning client, and a budget check — extended
  to a repository/client scope that has no project tier to fall through (Discovery has no
  `Project`), which is this change's one behavior change to an existing capability, below.
- Execution reuses the existing `Job`/`Agent`/`AgentRun` runtime exactly as Constitution drafting
  does today (durable, retried, cost-tracked, budget-enforced) — a new `JobType` and a new
  `AgentExecutor` method, not a parallel execution mechanism. AI output is Zod-schema-validated
  before ever being written as a `RepositoryDiscovery` row, matching this codebase's existing
  "AI output → schema → domain command" discipline.
- Every Discovery run's start and completion (or failure) is an `AuditEvent`, in the same
  transaction as the state change, per this codebase's non-negotiable audit rule.

## Capabilities

### New Capabilities

- `repository-discovery`: the `RepositoryDiscovery`/`RepositoryContext` mechanism — triggering a
  run, its evidence-gathering and AI-analysis execution, versioning, audit, and the repository
  detail page that surfaces it.

### Modified Capabilities

- `ai-cost-budgets`: extends the existing project-scoped budget-check requirement to also cover a
  repository-scoped AI action, which has no project tier to fall through — client's threshold,
  else the organization's, else unbounded (skipping the project tier entirely, not treating it as
  absent-and-continue). Also extends the "AI cost is summable" requirement so a client's rollup
  includes Discovery run costs, not only stage-drafting and Constitution costs.

## Impact

- **Schema/migration**: new `RepositoryDiscovery` model (versioned, one row per run, FK to
  `Repository` and nullable FK to `AgentRun`), new `DiscoveryStatus` enum, new `RUN_REPOSITORY_DISCOVERY`
  value on the existing `JobType` enum. No changes to any existing table's columns.
- **Domain layer**: new `src/domain/repository-discovery/` (commands: `runRepositoryDiscovery`,
  `completeRepositoryDiscovery`, `revertRepositoryDiscoveryFailure`; queries: `getRepositoryContext`,
  `listRepositoryDiscoveries`); `src/domain/agent/commands.ts` gains a client-scoped budget check
  used alongside the existing project-scoped one; `src/lib/integrations/github.ts` gains a
  read-only repository-contents fetch function; `src/lib/agents/types.ts`'s `AgentExecutor` gains
  `executeRepositoryDiscovery`, implemented in both `mockExecutor.ts` and `claudeExecutor.ts`;
  `worker.ts` gains a handler for the new job type.
- **API routes**: new `POST /api/repositories/[id]/discovery` (trigger a run).
- **UI**: new `/repositories/[id]` detail page (Discovery panel: current `RepositoryContext`
  summary or an empty state with a "Run Discovery" button, plus run history), reachable via a link
  from the client detail view's existing repository rows (Slice 12) — no change to
  `clients-hub`'s own requirements, since those rows already show a client's repositories; this
  only makes them navigable.
- **No changes** to `Constitution`, the SDD pipeline (`Stage`/`Pipeline`), evidence-driven
  completion, or connector sync mechanics — Discovery is Repository-scoped, entirely independent
  of `Project`/`WorkItem`.
