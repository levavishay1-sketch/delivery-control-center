## Roadmap Source

Implements `docs/ROADMAP.md`'s **Slice 3 — Agents as real execution
resources** row, sourced from
`docs/roadmap-sources/2026-08-14-gap-analysis-full.md` §5:

> ### Slice 3 — Agents as real execution resources
>
> - `Agent` registry and configurable routing (e.g. React→Frontend Agent,
>   Dataverse→Data Agent, Security→Human).
> - **`AgentRun`** entity per the master prompt §26: runtime, model, status,
>   input/output references, tool calls, token usage, cost, retryCount,
>   error. Migrate the per-stage cost fields into it without losing history.
> - Retry with backoff, per-run limits, structured errors.
> - AI cost rollups per work item / project / client, warning thresholds,
>   budgets, and a hard stop or approval requirement when a budget is
>   exceeded.
> - Restricted, permissioned visibility of raw run detail.

## Why

Today there is exactly one `AgentExecutor` (mock or Claude, picked by a
single env var), and every draft's cost/token/model fields live directly on
`Stage`/`Constitution` — overwritten on redraft (Slice 2's `StageVersion`
mitigates loss of *content*, but not of run-level execution detail: tool
calls, retry count, structured errors). There is no way to route different
stage types to different models, no cost visibility above a single draft,
and no budget enforcement — a runaway project can draft indefinitely at
unbounded cost. This slice makes AI execution a first-class, inspectable,
boundable resource instead of an invisible side effect of drafting.

## What Changes

- New `Agent` registry: named, configured entries (model, provider,
  routing key) that `config/workflow.yaml` can route each stage type to —
  replacing the single global `AI_MODEL`/mock-fallback switch with a
  per-stage-type choice. **Scope decision, not in the source document**:
  routing keys off `StageType` (config-driven, same mechanism as Slice 2's
  `approverRoles`), not work-item type/technology as the source's
  illustrative examples suggest — those examples describe routing by a
  domain/technology classification this codebase has no field for yet, and
  inventing one is a bigger, separate decision. Flagged here for review,
  not silently chosen; see design.md.
- New `AgentRun` entity: one row per drafting attempt-*cycle* (i.e., per
  `Job`, including its internal retries) — agent used, model, status,
  token usage, cost, retry count, structured error, timestamps. Existing
  `Stage`/`Constitution`/`StageVersion` cost columns become derived from
  the latest successful `AgentRun` rather than the source of truth;
  historical data is backfilled into `AgentRun` rows, not discarded.
- Cost rollups: aggregate queries summing `AgentRun.costUsd` per work item,
  project, and client.
- Budgets: a configurable threshold per client/project; exceeding it
  blocks further drafting until a human explicitly approves continuing
  (not a silent hard stop with no path forward).
- Permissioned visibility: raw `AgentRun` detail (prompts, tool calls,
  structured errors) restricted to write-capable roles; read-only roles
  see status/cost summary only.
- **Not in this slice** (explicitly deferred, per the source document's own
  boundaries and this project's Non-Goal precedent from Slice 2): tool-use
  / multi-step agent runs (`AgentRun.toolCalls` is captured as data if the
  executor ever produces it, but no executor in this codebase calls tools
  today — Claude drafting remains single-turn); a general per-project/client
  hierarchical config system (Slice 6's job) — `Agent` routing config lives
  in the same global `config/workflow.yaml` Slice 0–2 already established,
  not a new per-tenant config layer.

## Capabilities

### New Capabilities
- `agent-registry`: named `Agent` entries and stage-type-keyed routing,
  replacing the single global executor switch.
- `agent-run-tracking`: the `AgentRun` entity — one row per drafting
  attempt-cycle, capturing model/status/tokens/cost/retries/structured
  error — and permissioned visibility of its raw detail.
- `ai-cost-budgets`: cost rollups per work item/project/client, a
  configurable budget threshold, and blocking further drafting until an
  explicit approval once it's exceeded.

### Modified Capabilities
- `ai-drafting`: "every draft records its model, token usage, and cost"
  moves from being recorded directly on `Stage`/`Constitution` to being
  recorded on an `AgentRun`, which `Stage`/`Constitution` reference; "the
  drafting mechanism is swappable" extends to per-stage-type routing via
  the new `Agent` registry, not just a single global provider choice.

## Impact

- `prisma/schema.prisma`: new `Agent`, `AgentRun` models; `Stage`,
  `Constitution`, `StageVersion` gain a nullable `agentRunId` FK (additive
  migration + backfill, per this project's protected migration-history
  invariant).
- `src/domain/agent/` (new): registry CRUD/lookup, `AgentRun` recording,
  cost rollup queries, budget check.
- `src/lib/agents/`: `AgentExecutor` implementations write through
  `AgentRun` instead of returning raw fields the caller writes directly to
  `Stage`/`Constitution`.
- `worker.ts`: `DRAFT_STAGE`/`DRAFT_CONSTITUTION` handlers create/update an
  `AgentRun` per job attempt-cycle; a budget-exceeded check gates enqueuing
  a new drafting job.
- `config/workflow.yaml`: stage entries gain an `agent` routing key
  (defaulting to today's single global choice if unset, so existing
  pipelines' behavior doesn't change).
- New UI: `AgentRun` detail (permissioned), cost-rollup display on
  project/client views, budget configuration and the approve-to-continue
  flow when exceeded.
