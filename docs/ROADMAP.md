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

**`docs/roadmap-sources/2026-08-14-master-prompt-gap-analysis.md`** —
received verbatim from the user on 2026-08-14, explicitly identified as
"the original authoritative Master Prompt / gap-analysis source." Everything
below is derived from it; section numbers (`§0`–`§9`) refer to that file.

This supersedes an earlier version of this roadmap that carried the same
six-slice shape only as unverified, one-line paraphrases reconstructed from
a compacted conversation summary — that version's content had no
independent source and could not be trusted as scope. It's fully replaced
now that the real document has been persisted.

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
| 0 | Tenancy, identity, and the cheap fixes | **Done** | `2026-08-14-master-prompt-gap-analysis.md` §5 "Slice 0" (retroactively corroborated — built from a session-local plan before this source was persisted; scope matches) | `openspec/changes/archive/2026-08-14-slice-0-tenancy-and-identity/` |
| 1 | The delivery model and the Attention Center | **Scoped — not started** | `2026-08-14-master-prompt-gap-analysis.md` §5 "Slice 1" | — |
| 2 | SDD as a subsystem | **Scoped — not started** | `2026-08-14-master-prompt-gap-analysis.md` §5 "Slice 2" | — |
| 3 | Agents as real execution resources | **Scoped — not started** | `2026-08-14-master-prompt-gap-analysis.md` §5 "Slice 3" | — |
| 4 | Connector framework | **Scoped — not started** | `2026-08-14-master-prompt-gap-analysis.md` §5 "Slice 4" | — |
| 5 | Engineering evidence | **Scoped — not started** | `2026-08-14-master-prompt-gap-analysis.md` §5 "Slice 5" | — |
| 6 | Configuration Center | **Scoped — not started** | `2026-08-14-master-prompt-gap-analysis.md` §5 "Slice 6" | — |

"Scoped" means the source document's own scope for that slice (below) is
authoritative and ready for an OpenSpec proposal — it does **not** mean a
plan has been written, approved, or implementation started. Per the source
document's own §9 process, each slice still requires a concrete
implementation plan mapped to real files/migrations, with the user's
explicit approval, before any code is written.

### Slice 1 — The delivery model and the Attention Center

*(Verbatim scope: see `2026-08-14-master-prompt-gap-analysis.md` §5. Summary
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
