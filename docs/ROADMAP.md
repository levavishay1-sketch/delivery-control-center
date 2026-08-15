# Delivery Control Center — Roadmap

This is the durable, repo-level source of truth for what this product is
trying to become and what's been done toward it. It exists so that the
program's scope — the master goal, the gap analysis, and the plan for future
slices — never depends on chat history or survives only as a fading
conversation summary. See `docs/roadmap-sources/README.md` for why.

**Rule**: nothing goes in the "Slices" table below as more than a status
stub until its scope is backed by either a file in `docs/roadmap-sources/`
or an explicit, dated decision recorded in this file. No slice is scoped
from memory of a prior conversation.

## Source of truth

**`docs/roadmap-sources/2026-08-14-gap-analysis-full.md`** — the primary
source, received verbatim from the user on 2026-08-14. Its own Part 5 is
the same "Evolve Delivery Control Center into the real product" prompt
saved earlier the same day as `2026-08-14-master-prompt-gap-analysis.md`
(kept, not deleted, per the immutable-source rule — but superseded as the
thing to cite going forward, since the full file is a strict superset).
Section numbers (`§0`–`§9`, `Part 1`–`Part 6`) below refer to the full file
unless noted otherwise.

**Still outstanding**: this document is itself a summary/gap-analysis of a
different, referenced-but-never-provided document — "Claude Code Master
Prompt — AI Delivery Control Center.md" (70 sections, cited throughout as
`§4`, `§20`, `§26`, `§58`, etc.). That underlying document has not been
persisted here. The gap-analysis file gives real detail (e.g. 3 of the 9
`WorkStatus` states by name: `decision_required`, `blocked`, `review`) but
not everything — see the "Open gaps" note under Slice 1 below for exactly
what's still unspecified and how it's being handled.

This supersedes an earlier version of this roadmap that carried the same
six-slice shape only as unverified, one-line paraphrases reconstructed from
a compacted conversation summary — that version's content had no
independent source and could not be trusted as scope. It's fully replaced
now that the real document has been persisted.

## Gap register (source: Part 2.2, 45 items)

The full item-by-item comparison between the vision and what's built.
**KEEP** = correct as-is · **EXTEND** = built but too thin · **MISSING** =
absent · **CONFLICT** = the two source documents disagree (resolved in
Part 4, see "Resolved conflicts" below). Each slice's scope below draws
directly from this register; item numbers are referenced there.

**Domain & work model**

| # | Item | State |
|---|---|---|
| 1 | Work item type (project/task/bug/change) | MISSING *(done in Slice 1)* |
| 2 | risk, priority, owner, executorType, dueDate, progress | MISSING *(done in Slice 1)* |
| 3 | 9-state `WorkStatus` (incl. `decision_required`, `blocked`, `review`) | MISSING *(done in Slice 1)* |
| 4 | `parentId` — work item decomposition | MISSING *(done in Slice 1)* |
| 5 | Organization → Client → Project hierarchy | MISSING *(done in Slice 0)* |
| 6 | Dependencies between work items | MISSING *(done in Slice 1)* |
| 7 | Critical path | MISSING (depends on #6) — **still stubbed** (`getCriticalPath()` returns `[]`); Slice 1 built the dependency graph and cycle detection #6 depends on, but explicitly deferred critical-path analysis to Slice 2 per the original scope. |
| 8 | Blocker as a first-class object | MISSING *(done in Slice 1)* |
| 9 | Decision object (question/reason/impact/aiRecommendation/aiConfidence/deadline) | EXTEND (`Approval` has the outcome, not the context) *(done in Slice 1 — `Decision` is now its own model with the full shape named here; `Approval` remains the separate pipeline-stage-gate outcome, deliberately not merged)* |

**Attention & UX**

| # | Item | State |
|---|---|---|
| 10 | Attention Center | MISSING *(done in Slice 1)* |
| 11 | Dashboard as command center | MISSING *(done in Slice 1)* |
| 12 | Quick View drawer | MISSING *(done in Slice 1)* |
| 13 | Progressive disclosure (3 levels) | MISSING *(done in Slice 1 — Attention/Dashboard → Quick View → 360° Record)* |
| 14 | 360° Delivery Record (9 tabs) | EXTEND (`/pipelines/[id]` ≈ 1 tab) *(partially done in Slice 1 — Overview/Dependencies/Timeline built for real; Code/Tests/Evidence/Configuration are honest "Coming soon" stubs, not the remaining ~5 tabs; those need Slice 5's evidence entities to be real)* |
| 15 | Per-work-item timeline | EXTEND (data exists, only a global 200-row feed) *(done in Slice 1 — `AuditEvent.workItemId` + the 360° Record's Timeline tab + the audit trail's own filters/pagination; the 200-row cap is gone)* |
| 16 | Ctrl+K command palette / global search | MISSING — still not built. |
| 17 | UI states (loading/empty/error/partial/stale/permission-denied) | EXTEND *(partially done in Slice 1 — loading/empty states exist on every new page; no dedicated "stale" or "partial" state, no global error boundary beyond inline error text)* |
| 18 | Explainability on every status/risk/recommendation | MISSING *(done in Slice 1 — every Attention Center row, and the 360° Record's Overview tab, states a reason/explanation next to every status, risk, and recommendation; enforced as a design constraint in the delivery-model spec)* |
| 19 | Responsive + WCAG 2.2 AA | MISSING *(partially done in Slice 1 — every new page uses semantic sections, `aria-label`/`role` on interactive elements (tabs, dialogs), and responsive grid breakpoints; not independently audited against the full WCAG 2.2 AA checklist, so "partially done" rather than "done")* |

**SDD engine**

| # | Item | State |
|---|---|---|
| 20 | Clarify stage | MISSING |
| 21 | Analyze stage | MISSING |
| 22 | Constitution as project-scoped versioned artifact | CONFLICT (built per-work-item) |
| 23 | Final stage = Implement (real code) | CONFLICT (built final stage = Deploy doc) |
| 24 | Configurable, role-based gate policy | EXTEND (`requiresApproval` read by nothing *(fixed in Slice 0)*) |
| 25 | Versioned artifacts, pause/resume run state machine | EXTEND (`AI_DRAFTING` was a dead enum *(observability fixed in Slice 0)*) |
| 26 | Pipeline optional per work item | CONFLICT (auto-created 1:1 today) |

**AI execution**

| # | Item | State |
|---|---|---|
| 27 | Agent registry + configurable routing | MISSING |
| 28 | `AgentRun` entity | MISSING |
| 29 | AI output → schema → validation → policy → domain command | MISSING |
| 30 | Sandboxed coding runtime | MISSING |
| 31 | AI cost rollups, budgets, thresholds | EXTEND (per-draft cost captured, never summed) |
| 32 | Retry/backoff on AI/integration calls | MISSING |

**Integrations, config, evidence, platform**

| # | Item | State |
|---|---|---|
| 33 | Connector/SyncRun entities | EXTEND (`IntegrationAdapter` interface exists) |
| 34 | Conflict handling (manual wins, surfaced) | MISSING |
| 35 | Field-level provenance | EXTEND (row-level only) |
| 36 | Azure DevOps adapter | MISSING *(now explicitly rejected rather than silently aliased, Slice 0)* |
| 37 | Repositories/git/PRs/commits/tests awareness | MISSING |
| 38 | Evidence-driven completion | MISSING |
| 39 | Hierarchical config, impact preview, versioning | MISSING |
| 40 | Roles & real backend authorization | MISSING *(done in Slice 0)* |
| 41 | Per-client credential isolation | MISSING *(done in Slice 0)* |
| 42 | Workflow engine / durable long-running processes | MISSING |
| 43 | REST read API, OpenAPI | MISSING |
| 44 | Definition of Done: tests, validation, authz, states, audit | MISSING *(test framework + CI done in Slice 0)* |
| 45 | Idempotency | KEEP (partial — work-item upsert only) |

*(Items marked "done in Slice 0" above are annotations added when updating
this roadmap after Slice 0 shipped — not present in the original source.)*

## Master goal (source: `§0`)

> A control plane that always answers four questions — **what is happening,
> why, does anyone need to act, what happens next** — across the path from
> business request to verified delivery.

What's built today (the SDD pipeline: Constitution → SPEC → Plan → Tasks →
Deploy, gated, audited, AI-drafted) is explicitly named the **"engine
room"** of that product — correct, and kept — but only a fraction of it.
Missing: the delivery model, attention, blockers, decisions, dependencies,
and evidence layers around it.

## What must be protected while building the rest (source: `§1`–`§2`)

Non-negotiable constraints that apply to every future slice, not just one:

- `recordAuditEvent()` in `src/lib/audit.ts` stays the *only* write path for
  `AuditEvent`, always inside the same transaction as the state change.
- The `AgentExecutor` and `IntegrationAdapter` interfaces are extended, not
  replaced; the mock executor must keep working with no API key.
- `config/workflow.yaml` + `config/prompts/*.md` stays the config-driven
  mechanism; only its scope widens (global → hierarchical) in Slice 6.
- Real usage-based token/cost capture from the API's actual `usage`, never
  estimated.
- Prisma migration history is additive only — `20260814065231_init` is
  never reset, squashed, or recreated.
- Stack is fixed: Next.js 16 App Router, React, TypeScript, Tailwind v4,
  Postgres, Prisma 7 + `@prisma/adapter-pg`. No new UI component library
  without a proposal + approval first.
- The app stays one Next.js application — no service split, no Temporal.
- A `src/domain/<aggregate>/` layer holds all business rules and all Prisma
  access; no Prisma import outside it. Every domain command: Zod-validate →
  authorize → transaction → audit event in the same transaction → typed
  result. (Slice 0 already established this pattern for its aggregates;
  future slices extend it per-aggregate, not replace it.)
- Long-running work (AI drafting, syncs) moves to a persisted, idempotent,
  retried `Job` model — not left as a blocking HTTP call with nothing to
  show for a failure.
- AI never writes authoritative state directly: AI output → Zod schema →
  validation → policy check → domain command → state change. Never
  `JSON.parse` a model response without schema validation.

## Resolved conflicts between the vision doc and the original Master Prompt (source: `§3`)

These are settled decisions, not open questions for a future slice to
re-litigate:

1. Constitution becomes a project-scoped, versioned artifact (not
   per-work-item). *(Slice 2.)*
2. Default stage list becomes `SPEC → Clarify → Plan → Tasks → Analyze →
   Implement`, with `Deploy` as an optional final gate. *(Slice 2.)*
3. Stage order is snapshotted onto the `Pipeline` at creation — editing
   `workflow.yaml` must never alter a run already in flight. *(Active bug
   today; fix lands with Slice 2.)*
4. A pipeline is optional and explicitly started by the user — the current
   1:1 auto-creation is removed (existing rows migrated, not dropped).
   *(Slice 2.)*
5. Rejection comments and clarification answers must reach the redraft
   context — today redraft silently repeats the identical prompt. *(Slice 2.)*
6. `requiresApproval` must actually gate (fixed in Slice 0), and gate policy
   becomes role-based and config-driven (e.g. SPEC→PM, Plan→Tech Lead).
   *(Full role-based-per-stage-type policy lands in Slice 2; Slice 0 only
   made the binary flag functional.)*

## Slices

| # | Name | Status | Source | Detail |
|---|---|---|---|---|
| 0 | Tenancy, identity, and the cheap fixes | **Done** | `2026-08-14-gap-analysis-full.md` §5 "Slice 0" (retroactively corroborated — built from a session-local plan before this source was persisted; scope matches) | `openspec/changes/archive/2026-08-14-slice-0-tenancy-and-identity/` |
| 1 | The delivery model and the Attention Center | **Done** | `2026-08-14-gap-analysis-full.md` §5 "Slice 1" | `openspec/changes/archive/2026-08-14-slice-1-delivery-model/` |
| 2 | SDD as a subsystem | **Scoped — not started** | `2026-08-14-gap-analysis-full.md` §5 "Slice 2" | — |
| 3 | Agents as real execution resources | **Scoped — not started** | `2026-08-14-gap-analysis-full.md` §5 "Slice 3" | — |
| 4 | Connector framework | **Scoped — not started** | `2026-08-14-gap-analysis-full.md` §5 "Slice 4" | — |
| 5 | Engineering evidence | **Scoped — not started** | `2026-08-14-gap-analysis-full.md` §5 "Slice 5" | — |
| 6 | Configuration Center | **Scoped — not started** | `2026-08-14-gap-analysis-full.md` §5 "Slice 6" | — |

"Scoped" means the source document's own scope for that slice (below) is
authoritative and ready for an OpenSpec proposal — it does **not** mean a
plan has been written, approved, or implementation started. Per the source
document's own §9 process, each slice still requires a concrete
implementation plan mapped to real files/migrations, with the user's
explicit approval, before any code is written.

### Slice 1 — The delivery model and the Attention Center

*(Verbatim scope: see `2026-08-14-gap-analysis-full.md` §5. Summary
below; the source file is authoritative if this drifts from it.)*

- `WorkItem` extended to the full shape: `type`, `parentId`, 9-state
  `WorkStatus`, `risk`, `priority`, `ownerId`, `executorType`/`executorId`,
  `dueDate`, `progress`, `sourceMode`, `aiCost`.
- New first-class entities: `Dependency` (with cycle detection),
  `Blocker`, `Decision` (existing `Approval` becomes the decision *outcome*
  on stage gates — reused, not duplicated).
- Attention Center (`/attention`): every item needing a human, grouped by
  type, each with a stated reason, owner, and required action.
- Dashboard becomes a command center; Quick View side drawer; 360° Delivery
  Record (Overview/Dependencies/Timeline in this slice, other tabs stubbed
  honestly); Dependency Map that's explanatory, not decorative.
- Audit trail gets filters and pagination (fixing the current 200-row
  silent truncation).
- End-to-end scenario that must work against the real DB: create client →
  project → work item → dependency → blocker → appears in Attention Center
  with full explanation → Quick View → resolve blocker → timeline and audit
  both reflect it.

**Open gaps — not invented, flagged for the implementation plan**: the
source names `type` as `type` (values: project/task/bug/change, given
directly) and 3 of `WorkStatus`'s 9 states (`decision_required`, `blocked`,
`review`), but does not give the remaining 6 `WorkStatus` values, a
risk scale, a priority scale, `executorType`'s value set, or `sourceMode`'s
value set — these are only referenced by name, not defined, in both
persisted source files. Any implementation plan must either (a) get these
from the still-missing 70-section Master Prompt document, or (b) propose
concrete values as an explicit, clearly-labeled assumption for approval
before any migration is written — never silently choose values.

### Slice 2 — SDD as a subsystem

Constitution as a versioned project artifact; `Clarify` stage that pauses
the run and waits for a human answer instead of guessing; `Analyze` stage
producing severity-rated consistency findings that can block implementation;
versioned (not overwritten) stage artifacts; a run state machine that
survives process restarts (built on Slice 0's `Job` model); role-based
config-driven gate policy; rejection/clarification feedback reaching
redrafts. Full detail: source §5 "Slice 2".

### Slice 3 — Agents as real execution resources

`Agent` registry with configurable routing; `AgentRun` entity (runtime,
model, status, tool calls, tokens, cost, retries, error) replacing the
per-stage cost fields without losing history; retry with backoff; AI cost
rollups with budgets and hard stops; permissioned visibility of run detail.
Full detail: source §5 "Slice 3".

### Slice 4 — Connector framework

`Connector`/`SyncRun` entities; field-level provenance (source, externalId,
actor, timestamp per value); conflict handling where manual edits win by
default and conflicts surface for review; Azure DevOps and GitHub adapters;
idempotent webhook intake; no connector-specific logic inside the core
domain. Full detail: source §5 "Slice 4".

### Slice 5 — Engineering evidence

Repository/branch/commit/PR/test-run/build/deployment entities; Code &
Changes and Tests tabs tracing work item → code change; `Evidence` entity
and evidence-driven completion — a work item is only "done" with mandatory
evidence present or an explicitly approved exception. Full detail: source
§5 "Slice 5".

### Slice 6 — Configuration Center

Hierarchical config (Organization → Client → Project → Repository → Work
Item) with inheritance/overrides, effective-value display, impact preview
before saving, and config versioning/audit. Full detail: source §5
"Slice 6".

## Definition of Done, for every future slice (source: `§6`)

Not done until it has: persistent backend state with a migration, Zod
input validation, backend authorization (not a hidden button), loading/
empty/error/permission-denied states, an audit event in the same
transaction as the state change, tests (domain unit always; Playwright for
user-facing flows), and an accessible (WCAG 2.2 AA target) responsive
layout. No silent failure, no placeholder-only interaction. Every important
status carries a textual rationale; Approve/Reject is never rendered
without context; anything imported stays manually creatable/editable with
provenance preserved.

## UI direction (source: `§7`)

Modern enterprise SaaS — calm, information-dense without clutter, strong
hierarchy. Semantic colors paired with labels/icons, never color alone.
Three levels of disclosure: Dashboard/Attention → Quick View → 360° Record.

## What this product is not (source: `§8`)

Not a Jira clone, Kanban board, AI chatbot, GitHub dashboard, or a set of
disconnected admin screens. It is orchestration and delivery control.

## How a slice gets scoped and built from here on

1. **Source lands first.** Any further planning input (revisions to this
   document, answers to open questions, new requirements) is saved verbatim
   to `docs/roadmap-sources/<date>-<slug>.md` in the same turn it's
   received, before any discussion of scope or design.
2. **This file is updated to point at it**, and to reconcile the summary
   above if the new input changes it.
3. **The OpenSpec proposal cites it.** Every `proposal.md` for a roadmap
   slice includes a `## Roadmap Source` section (first section, before
   "Why") naming the slice's row above and quoting the specific
   `docs/roadmap-sources/` excerpt the scope comes from. Enforced by
   `openspec/config.yaml`'s `rules.proposal`.
4. **Before writing code for a slice**, per the source document's own §9: a
   concrete implementation plan mapped to real files and migrations, with
   the tests intended, and explicit user approval — the same process
   Slice 0 went through.
5. **`tasks.md` inherits traceability for free** once `proposal.md` is
   itself sourced — OpenSpec's existing spec-anchored discipline (see
   `CLAUDE.md`) already keeps `tasks.md` and `openspec/specs/` truthful to
   what's actually built.
6. **When a slice finishes**, its status here moves to "Done" and its row
   links to the archived OpenSpec change, the same way Slice 0's does.

## Status legend

- **Not started — scope stub only**: a label exists, nothing else. Must not
  be scoped or implemented from this file alone. (No slice is currently in
  this state — all of 1–6 now have real, sourced scope.)
- **Scoped — not started**: backed by a real source document, ready for an
  OpenSpec proposal; no plan written or approved yet.
- **In progress**: an OpenSpec change is open for it.
- **Done**: archived; linked to the archive folder.
