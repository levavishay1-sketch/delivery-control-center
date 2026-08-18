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

**`docs/roadmap-sources/2026-08-17-core-product-definition.md`** — a second,
later primary source, received verbatim from the user on 2026-08-17 (86
numbered sections). The user's own framing: treat it as *"the product
definition for the Delivery Control Center... one connected product, not a
disconnected list of features,"* explicitly *not* to be reduced to "a
simple task-management application." It governs **all future slices**
alongside (not replacing) the sources above — every capability proposed
from this point on must be evaluated against it, not just against the
2026-08-16 blueprint below.

**Relationship to the Slices 11–21 vision blueprint** (next source entry):
this document was received *after* Slices 12–13 were already implemented
and archived under that blueprint's terms, and *before* Slice 14 was
scoped — the user stopped deliberately at that point ("stop here and don't
continue to next") specifically to have this new definition established
first. It introduces several concepts with no current equivalent
(`Requirement` as an entity distinct from `Project`/`WorkItem`, `Connection`
vs. `Source` as distinct from today's single `Connector`, Repository
Discovery/Context/System Context, a `Change`/revision model, an Autonomy
Policy hierarchy, Question/Approval/Review as three separate concepts, an
Owner/Decision-Owner split, hierarchical completion gating) and reframes —
in places with materially more detail — sections the old blueprint had
already sketched for Slices 14–21 (most directly, its §5.3 one-paragraph
sketch of repository SDD-bootstrap vs. this document's §8–13 on Repository
Discovery/Context/Maintenance/System Context/Reconciliation). The Slices
14–21 rows below are left exactly as they were scoped — **not** marked
superseded or resolved by this file alone; that reconciliation is recorded
in
`docs/roadmap-sources/2026-08-17-core-product-definition-gap-analysis.md`,
which maps every one of this document's 86 sections against the current
implementation (with file:line evidence) and against those existing
stubs. That file's Part 2 originally listed nine open terminology/
structural questions blocking any slice in these areas — **all nine were
resolved by the user on 2026-08-17** (recorded there as Decisions 1-9:
"Customer" was a naming mistake and stays `Client`; `Connection`/`Source`
are new, deliberately open-taxonomy concepts; `Requirement` is a flexible,
optionally-Project-linked intake item; Question/Approval/Review extend the
existing three models in place; Change/Revisions is deferred; Autonomy
starts at `Platform → Client → (flexible)`; Blocker severity is deferred
but architecturally kept open; parallel-AI Conflicts get a dedicated new
model, not `SyncConflict`; model selection happens per AI operation, not
per Requirement). No slice's status changes as a result of this entry or
that resolution alone — re-scoping Slice 14 (or any other) against these
decisions is still a separate, later step.

**`docs/roadmap-sources/2026-08-18-client-tasks-section.md`** — a
standalone, ad hoc user feature request received 2026-08-18 (not part of
the Slices 11–21 Product Vision & Flow Blueprint sequence): a new "Tasks"
section on the Client detail page, listing every top-level (parentless)
open `WorkItem` across the client's projects, of any type. Two material
ambiguities in the original wording ("REQUIRED," and which "Project" is
meant) were resolved via direct clarification with the user before scoping;
both the original request and the resolved answers are recorded verbatim in
that file. Scoped as Slice 22 below.

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
| 14 | 360° Delivery Record (9 tabs) | EXTEND (`/pipelines/[id]` ≈ 1 tab) *(Overview/Dependencies/Timeline done in Slice 1; Code/Tests/Evidence done in Slice 5 — real, backed by GitHub-sourced entities; the 360° Record's own per-work-item Configuration tab remains an honest "Coming soon" stub — Slice 6 built Organization/Client/Project-scoped AI budget configuration, not a Work-Item scope, a confirmed Non-Goal — see Slice 6's design.md)* |
| 15 | Per-work-item timeline | EXTEND (data exists, only a global 200-row feed) *(done in Slice 1 — `AuditEvent.workItemId` + the 360° Record's Timeline tab + the audit trail's own filters/pagination; the 200-row cap is gone)* |
| 16 | Ctrl+K command palette / global search | MISSING — still not built. |
| 17 | UI states (loading/empty/error/partial/stale/permission-denied) | EXTEND *(partially done in Slice 1 — loading/empty states exist on every new page; no dedicated "stale" or "partial" state, no global error boundary beyond inline error text)* |
| 18 | Explainability on every status/risk/recommendation | MISSING *(done in Slice 1 — every Attention Center row, and the 360° Record's Overview tab, states a reason/explanation next to every status, risk, and recommendation; enforced as a design constraint in the delivery-model spec)* |
| 19 | Responsive + WCAG 2.2 AA | MISSING *(partially done in Slice 1 — every new page uses semantic sections, `aria-label`/`role` on interactive elements (tabs, dialogs), and responsive grid breakpoints; not independently audited against the full WCAG 2.2 AA checklist, so "partially done" rather than "done")* |

**SDD engine**

| # | Item | State |
|---|---|---|
| 20 | Clarify stage | MISSING *(done in Slice 2)* |
| 21 | Analyze stage | MISSING *(done in Slice 2)* |
| 22 | Constitution as project-scoped versioned artifact | CONFLICT (built per-work-item) *(resolved in Slice 2 — new `Constitution` model, project-scoped, versioned, referenced by `Pipeline.constitutionVersion`)* |
| 23 | Final stage = Implement (real code) | CONFLICT (built final stage = Deploy doc) *(partially resolved in Slice 2 — `IMPLEMENT` now exists in the default stage sequence, ahead of `DEPLOY`, but per design.md's Non-Goals it stays an AI-drafted document, not real code execution; Slice 5 closed the adjacent "status alone means done" gap via evidence-driven completion, but did not make `IMPLEMENT` itself real execution — genuinely closing this conflict is still open, unscoped)* |
| 24 | Configurable, role-based gate policy | EXTEND (`requiresApproval` read by nothing *(fixed in Slice 0)*) *(done in Slice 2 — `approverRoles: Role[]` per stage type in `config/workflow.yaml`, enforced in `approveStage`/`rejectStage`)* |
| 25 | Versioned artifacts, pause/resume run state machine | EXTEND (`AI_DRAFTING` was a dead enum *(observability fixed in Slice 0)*) *(done in Slice 2 — `StageVersion` (append-only content history) + the `Job`-backed run state machine, which survives a process restart; `AWAITING_CLARIFICATION` is the pause, durable as ordinary rows)* |
| 26 | Pipeline optional per work item | CONFLICT (auto-created 1:1 today) *(resolved in Slice 2 — `startPipeline` is now an explicit action requiring an approved Constitution; `createWorkItem` no longer auto-creates a `Pipeline`)* |

**AI execution**

| # | Item | State |
|---|---|---|
| 27 | Agent registry + configurable routing | KEEP (✓ Slice 3) |
| 28 | `AgentRun` entity | KEEP (✓ Slice 3) |
| 29 | AI output → schema → validation → policy → domain command | MISSING *(partially done in Slice 2 — `CLARIFY`'s questions and `ANALYZE`'s findings are now Zod-schema-validated before the domain layer treats them as authoritative; every other stage's raw content still isn't schema-validated the same way, so this is partial, not full, closure)* |
| 30 | Sandboxed coding runtime | MISSING |
| 31 | AI cost rollups, budgets, thresholds | KEEP (✓ Slice 3) |
| 32 | Retry/backoff on AI/integration calls | KEEP (✓ Slice 2 for AI drafting, ✓ Slice 4 for connector sync — both now run through the same `Job` runtime) |

**Integrations, config, evidence, platform**

| # | Item | State |
|---|---|---|
| 33 | Connector/SyncRun entities | KEEP (✓ Slice 4) |
| 34 | Conflict handling (manual wins, surfaced) | KEEP (✓ Slice 4) |
| 35 | Field-level provenance | KEEP (✓ Slice 4) |
| 36 | Azure DevOps adapter | KEEP (✓ Slice 4 — real adapter; GitHub adapter also added, not separately numbered here) |
| 37 | Repositories/git/PRs/commits/tests awareness | KEEP (✓ Slice 5) |
| 38 | Evidence-driven completion | KEEP (✓ Slice 5) |
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

What's built today (the SDD pipeline: SPEC → Clarify → Plan → Tasks →
Analyze → Implement → Deploy, run under a project-scoped versioned
Constitution, role-gated, audited, AI-drafted, job-backed) is explicitly
named the **"engine room"** of that product — correct, and kept — but only
a fraction of it. The delivery model, attention, blockers, decisions, and
dependencies layers (Slice 1) and the agent-execution, connector,
evidence, and hierarchical AI-budget configuration layers around the
engine room (Slices 3–6) are now built. Still missing: the items in
§"Missing" above that no slice has scoped yet.

## What must be protected while building the rest (source: `§1`–`§2`)

Non-negotiable constraints that apply to every future slice, not just one:

- `recordAuditEvent()` in `src/lib/audit.ts` stays the *only* write path for
  `AuditEvent`, always inside the same transaction as the state change.
- The `AgentExecutor` and `IntegrationAdapter` interfaces are extended, not
  replaced; the mock executor must keep working with no API key.
- `config/workflow.yaml` + `config/prompts/*.md` stays the config-driven
  mechanism for pipeline shape/prompts; Slice 6 widened AI budget alone
  (global → hierarchical, Organization → Client → Project), not this file.
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
   per-work-item). *(Done — Slice 2.)*
2. Default stage list becomes `SPEC → Clarify → Plan → Tasks → Analyze →
   Implement`, with `Deploy` as an optional final gate. *(Done — Slice 2,
   with one deviation: `Deploy` ships as the final stage after `Implement`
   rather than an optional separate gate — no config mechanism for
   "optional final stage" was built; both are always present in the
   default sequence.)*
3. Stage order is snapshotted onto the `Pipeline` at creation — editing
   `workflow.yaml` must never alter a run already in flight. *(Done —
   Slice 2. `Pipeline.stageSequence`.)*
4. A pipeline is optional and explicitly started by the user — the current
   1:1 auto-creation is removed (existing rows migrated, not dropped).
   *(Done — Slice 2. `startPipeline`.)*
5. Rejection comments and clarification answers must reach the redraft
   context — today redraft silently repeats the identical prompt. *(Done —
   Slice 2. `rejectionComment`/`clarifyAnswers` on `StageExecutionContext`.)*
6. `requiresApproval` must actually gate (fixed in Slice 0), and gate policy
   becomes role-based and config-driven (e.g. SPEC→PM, Plan→Tech Lead).
   *(Done — Slice 2. `approverRoles: Role[]` per stage type.)*

## Slices

| # | Name | Status | Source | Detail |
|---|---|---|---|---|
| 0 | Tenancy, identity, and the cheap fixes | **Done** | `2026-08-14-gap-analysis-full.md` §5 "Slice 0" (retroactively corroborated — built from a session-local plan before this source was persisted; scope matches) | `openspec/changes/archive/2026-08-14-slice-0-tenancy-and-identity/` |
| 1 | The delivery model and the Attention Center | **Done** | `2026-08-14-gap-analysis-full.md` §5 "Slice 1" | `openspec/changes/archive/2026-08-14-slice-1-delivery-model/` |
| 2 | SDD as a subsystem | **Done** | `2026-08-14-gap-analysis-full.md` §5 "Slice 2" | `openspec/changes/archive/2026-08-15-slice-2-sdd-subsystem/` |
| 3 | Agents as real execution resources | **Done** | `2026-08-14-gap-analysis-full.md` §5 "Slice 3" | `openspec/changes/archive/2026-08-15-slice-3-agents-as-execution-resources/` |
| 4 | Connector framework | **Done** | `2026-08-14-gap-analysis-full.md` §5 "Slice 4" | `openspec/changes/archive/2026-08-15-slice-4-connector-framework/` |
| 5 | Engineering evidence | **Done** | `2026-08-14-gap-analysis-full.md` §5 "Slice 5" | `openspec/changes/archive/2026-08-15-slice-5-engineering-evidence/` |
| 6 | Configuration Center | **Done** | `2026-08-14-gap-analysis-full.md` §5 "Slice 6" | `openspec/changes/archive/2026-08-15-slice-6-configuration-center/` |
| 7 | Design system foundation & premium UI refresh | **Done** | `2026-08-15-design-system-direction.md` | `openspec/changes/archive/2026-08-15-slice-7-design-system-refresh/` |
| 8 | i18n readiness & RTL support (Hebrew/English) | **Done** | `2026-08-15-i18n-rtl-support.md` | `openspec/changes/archive/2026-08-15-i18n-rtl-support/` |
| 9 | Dashboard motifs refresh (budget usage meter, real global search, nav polish) | **Done** | `2026-08-15-dashboard-motifs-direction.md` | `openspec/changes/dashboard-motifs-refresh/` (implemented, not yet archived) |
| 10 | Product-wide visual redesign (reference-driven design system overhaul) | **Done** | `2026-08-16-product-visual-redesign-reference.md` | `openspec/changes/archive/2026-08-16-product-visual-redesign/` |
| 11 | ⓘ info/explanation shared primitive | **Done** | `2026-08-16-product-vision-blueprint.md` §6.5, §4 | `openspec/changes/info-tooltip-primitive/` (implemented, not yet archived) |
| 12 | Client-owned Repository model + Clients hub | **Done** | `2026-08-16-product-vision-blueprint.md` §5.1, §5.2, §3 | `openspec/changes/archive/2026-08-16-client-repository-model/` |
| 13 | Client information sources (expanded `IntegrationType`) | **Done** | `2026-08-16-product-vision-blueprint.md` §3, §5.4 | `openspec/changes/archive/2026-08-16-client-information-sources/` |
| 14 | Repository Discovery & Context (bootstrap on connect) — re-scoped 2026-08-18 | **Done** | `2026-08-17-core-product-definition.md` §8-13, `2026-08-17-core-product-definition-gap-analysis.md` Part 3 | `openspec/changes/archive/2026-08-18-repository-discovery-context/` |
| 15 | Repository/source relevance recommendation | Scoped, not started | `2026-08-16-product-vision-blueprint.md` §5.4 | — |
| 16 | Project-wide Planner (dependency map + status board + focus + parallel) | Scoped, not started | `2026-08-16-product-vision-blueprint.md` §5.9, §5.13 | — |
| 17 | AI Recommendation card + executor recommendation/estimate | Scoped, not started | `2026-08-16-product-vision-blueprint.md` §4, §5.7 | — |
| 18 | Task/subtask decomposition materialization & approval | Scoped, not started | `2026-08-16-product-vision-blueprint.md` §5.5 | — |
| 19 | Cascading assignment with owner-decides conflict detection | Scoped, not started | `2026-08-16-product-vision-blueprint.md` §5.6 | — |
| 20 | AI model knowledge snapshot (weekly Claude-docs refresh) + model selection | Scoped, not started | `2026-08-16-product-vision-blueprint.md` §5.8, §3 | — |
| 21 | Configuration Center generalization (beyond budget) | Scoped, not started | `2026-08-16-product-vision-blueprint.md` §6.3 | — |

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

### Slice 2 — SDD as a subsystem — **Done**

Constitution as a versioned project artifact; `Clarify` stage that pauses
the run and waits for a human answer instead of guessing; `Analyze` stage
producing severity-rated consistency findings that can block implementation;
versioned (not overwritten) stage artifacts; a run state machine that
survives process restarts (built on a new `Job` model — a
pre-implementation planning error here previously said "Slice 0's `Job`
model," but Slice 0 never had one; `Job` was built in Slice 2 itself,
Task Group 1); role-based config-driven gate policy; rejection/clarification
feedback reaching redrafts. Full detail: source §5 "Slice 2"; as-built
detail: `openspec/changes/archive/2026-08-15-slice-2-sdd-subsystem/`.

### Slice 3 — Agents as real execution resources — **Done**

`Agent` registry with configurable routing; `AgentRun` entity (runtime,
model, status, tool calls, tokens, cost, retries, error) replacing the
per-stage cost fields without losing history; retry with backoff; AI cost
rollups with budgets and hard stops; permissioned visibility of run detail.
Full detail: source §5 "Slice 3". Archive detail:
`openspec/changes/archive/2026-08-15-slice-3-agents-as-execution-resources/`.

### Slice 4 — Connector framework — **Done**

`Connector`/`SyncRun` entities, run through the same `Job` runtime AI
drafting uses (retry with backoff, crash-durable); field-level provenance
(source, externalId, actor, timestamp per value); conflict handling where
manual edits win by default and conflicts surface for review — on the
Attention Center and a new project Settings page; real Azure DevOps and
GitHub adapters alongside Jira; idempotent webhook intake for both; no
connector-specific logic inside the core domain. Full detail: source §5
"Slice 4". Archive detail:
`openspec/changes/archive/2026-08-15-slice-4-connector-framework/`.

### Slice 5 — Engineering evidence — **Done**

`Repository`/`Commit`/`PullRequest`/`TestRun`/`Build`/`Deployment`
entities, populated from GitHub via webhook events and the GitHub
adapter's catch-up fetch, reusing Slice 4's `Connector`/webhook
infrastructure; `Evidence` — a work item's explicit (never inferred) link
to a pull request; evidence-driven completion — `APPROVED` → `COMPLETED`
now requires a linked, merged pull request whose latest test run passed,
or an approved `CompletionException`, closing the "status alone means
done" gap the source names as a non-negotiable. 360° Record's Code &
Changes and Tests tabs are real. Two scope decisions confirmed with the
user before implementation (not in the source): work-item-to-PR linking is
manual only for this slice (no branch/title-parsing auto-detection); the
completion policy is one fixed default for every project, not
per-project/per-type configurable (deferred to Slice 6). Full detail:
source §5 "Slice 5". Archive detail:
`openspec/changes/archive/2026-08-15-slice-5-engineering-evidence/`.

### Slice 6 — Configuration Center — **Done**

Hierarchical AI-budget configuration across Organization → Client →
Project (not Repository/Work Item — no existing inheritance-target
concept for either, confirmed out of scope with the user before
implementation): `Organization.aiBudgetUsd` joins the existing
`Client.aiBudgetUsd`/`Project.aiBudgetUsd` (Slice 3) nullable-Decimal,
unset-means-inherit pattern; `getEffectiveBudget` resolves the value and
its source (own override vs. inherited, and from which scope);
`previewBudgetImpact` names affected descendant clients/projects before
an Organization- or Client-scope change is confirmed and saved (Project
scope has no descendants, so it saves directly, no preview); a dedicated
append-only `ConfigChange` table (not folded into `AuditEvent`, which has
no `clientId`/`organizationId` FK to attach to) records every set/clear
with old/new value, who, and when; explicit reset-to-inherited, distinct
from saving an empty value. `checkBudget` (Slice 3) now falls through
Project → Client → Organization → unbounded. `requireOrgAdmin`
(existed since Slice 0, gated nothing until now) is Organization scope's
authz; Client/Project reuse the existing `requireClientRole(WRITE_ROLES)`.
The app's first Organization-scoped page:
`/organizations/[id]/config`. One scope decision confirmed with the user
before implementation (not in the source): config fields other than AI
budget (pipeline/gate policy, integration defaults, Slice 5's completion
policy) stay out of scope — the mechanics are designed to extend to a
second field later without a breaking change, but nothing else is wired
up in this slice. Its own E2E scenario caught a real gap before shipping:
`POST /api/config/projects/[id]/budget` had been marked done in
`tasks.md` but never actually existed, so project-scope saves were
silently 404ing. Full detail: source §5 "Slice 6". Archive detail:
`openspec/changes/archive/2026-08-15-slice-6-configuration-center/`.

### Slice 7 — Design system foundation & premium UI refresh — **Done**

*(Source: `docs/roadmap-sources/2026-08-15-design-system-direction.md` —
agent-produced design direction, approved by the user for implementation.
Not part of the original master prompt / gap analysis; this slice was
proposed and approved in conversation after all six master-prompt slices
completed.)*

Established a real design token system (`@theme` block in
`src/app/globals.css`: neutral scale, one accent color, five status-
semantic colors each with a paired background, a 6-step type scale, and
two elevation levels — flat hairline-border surfaces vs. floating shadow+
backdrop overlays) and applied it to the three core surfaces of the
existing Dashboard/Attention Center → Quick View → 360° Delivery Record
architecture (built in Slice 1): a persistent left icon+label navigation
rail (`NavRail`) replacing inline text links; new base components
(`StatusBadge` — reason required at the type level; `Row`/`RowList`;
`Panel`) applied to the Dashboard, Attention Center, Quick View drawer,
and 360° Record's `WorkItemTabs`/`OverviewTab`; the 360° Record's
Configuration tab now states why it's empty instead of a bare "Coming
soon"; tab order reshuffled to Overview → Dependencies → Evidence → Code →
Tests → Timeline → Configuration per the design direction. Explicitly no
new domain features, entities, or backend behavior — visual/structural UI
layer only, on top of the unchanged domain model.

Fixing real E2E selector drift from the restyle also surfaced and fixed a
pre-existing, unrelated navigation gap: `/pipelines/[id]` had no
page-specific "back to dashboard" link (already noted, deferred, before
this slice started) — the new nav rail's Dashboard link now works from
every page, closing that gap as a side effect. Full detail: source §
above; as-built detail:
`openspec/changes/archive/2026-08-15-slice-7-design-system-refresh/`.

### Slice 8 — i18n readiness & RTL support (Hebrew/English) — **Done**

*(Source: `docs/roadmap-sources/2026-08-15-i18n-rtl-support.md` — a direct
user requirement given in conversation immediately after Slice 7 shipped.
Not part of the original master prompt / gap analysis.)*

Added a lightweight locale mechanism (`src/lib/i18n/`: plain TypeScript
`en.ts`/`he.ts` dictionaries typed against each other so a missing Hebrew
key is a compile error, `LocaleProvider`/`useLocale()`/`useT()` for client
components, `getServerLocale()`/`getDictionary()` for Server Components,
`formatMessage`/`pluralize`/`formatDate`/`formatNumber` wrapping native
`Intl` — no new npm dependency) with English and Hebrew as the initial
locales. Locale is a browser-local cookie (`POST /api/locale`), not a
domain/backend concept — `RootLayout` reads it server-side via
`next/headers` and sets `<html lang dir>` before first paint, so there is
no LTR-then-RTL flash. RTL comes from the browser's native `dir` handling
plus Tailwind v4's logical CSS properties (`border-e`/`border-s`) and
built-in `rtl:`/`ltr:` variants, not a custom mirroring layer; most of
Slice 7's components (`StatusBadge`, `Row`/`RowList`, `Panel`) needed zero
CSS changes because their flexbox layout already followed reading
direction natively — only `NavRail` and `QuickViewDrawer`'s single
physical border each needed converting. `WorkItemTabs`' arrow-key
navigation reverses direction under RTL so "next tab" stays a logical
concept. Full Hebrew translation applied to Slice 7's four core surfaces
(Dashboard's attention-summary/quick-access/recent-activity sections,
Attention Center, Quick View drawer, 360° Record's Overview/Dependencies/
Timeline tabs and tab labels) plus the persistent nav rail and sign-out
button (global chrome, added beyond the literal task list since leaving
always-visible chrome in English would have undermined the point of a
"true RTL experience" — disclosed, not silent). Two scope decisions
(cookie-based locale over URL-prefixed routing; four-surface translation
coverage over whole-app) confirmed via the user deferring to "best
practice," reasoned in `proposal.md`. Known limitations, disclosed rather
than hidden: the Hebrew dictionary is hand-authored by the agent, not
reviewed by a native speaker; pluralization is a simplified one/other
split via `Intl.PluralRules`, not full Hebrew CLDR grammar; deeper
interactive sub-forms nested in the four surfaces (`AddDependencyForm`,
`CreateBlockerForm`, etc.) stay English-only, matching `tasks.md`'s
explicit file-level scope; pages outside the four surfaces (Audit Trail,
Configuration Center, pipeline detail, login) keep English strings but
inherit RTL-safe layout for free from the shared components. Full detail:
source above; as-built detail:
`openspec/changes/archive/2026-08-15-i18n-rtl-support/`.

### Slice 9 — Dashboard motifs refresh — **Done**

*(Source: `docs/roadmap-sources/2026-08-15-dashboard-motifs-direction.md`
— the agent's design-direction analysis of a user-provided consumer
cloud-storage dashboard reference, confirmed by the user. Not part of the
original master prompt / gap analysis. The source file is authoritative
if this summary drifts from it.)*

Adapts six motifs from the reference to real entities, keeping Slice 7's
one-accent-color and status-color rules intact (explicitly rejecting the
reference's literal multi-hue decorative cards and vanity trend charts):

- An AI-budget-usage donut chart (Dashboard and/or Configuration Center),
  built on existing `AI Cost`/`aiBudgetUsd` data (Slices 3, 6) — not a
  new metric.
- A solid accent-colored pill for `NavRail`'s active-item state (same
  single accent color, stronger active affordance).
- A real global search / Ctrl+K command palette — closing the roadmap gap
  register's item #16 ("still not built"), not a decorative search bar.
- Avatar stacks showing "who's involved" on project cards / Attention
  Center rows, from existing member data.
- A persistent primary CTA in the header (e.g. "+ New Work Item"),
  instead of an action buried in page-body forms.
- Roomier spacing / slightly larger corner radius on primary surfaces.

Implemented per `openspec/changes/dashboard-motifs-refresh/` (not yet
archived — this row was previously left as "Scoped, not started" after the
table above was updated to Done; corrected here so the two don't drift, per
CLAUDE.md's spec-anchored rule).

### Slice 10 — Product-wide visual redesign (reference-driven design system overhaul) — **Done**

*(Source: `docs/roadmap-sources/2026-08-16-product-visual-redesign-reference.md`
— a direct user requirement given in conversation on 2026-08-16, attaching a
reference screenshot of a purple-branded SaaS dashboard. Not part of the
original master prompt / gap analysis. The source file is authoritative if
this summary drifts from it.)*

A full visual redesign of the entire product's presentation layer — not a
palette swap — extracting the reference's complete design language
(application shell with a branded sidebar + light outer surface + large
white workspace, sidebar proportions and selected-state treatment, card/
panel geometry, typography scale, spacing/density, button/input/badge
language, table/list treatment, icon treatment, empty/loading/error/
disabled states, RTL-appropriate directional behavior) and applying it
consistently to every existing user-facing screen (Dashboard, Attention
Center, Quick View, 360° Delivery Record, pipeline detail, Configuration
Center, Audit Trail, login, and any others found during investigation) —
not only the Dashboard used as the reference's visual example.

Explicitly preserves all existing functionality, routes, business logic,
terminology, entities, and permissions — this is a presentation-layer
change, not a rebuild. Explicitly does not invent fake data/entities/metrics
to match the reference screenshot's example content; the redesigned
Dashboard uses this app's real data. Explicitly supersedes/reconciles with
Slice 7's design-token foundation and Slice 9's motif system where the
reference's direction differs (e.g., a stronger brand-color application via
a branded sidebar) rather than running two competing systems side by side —
the OpenSpec proposal must resolve this reconciliation explicitly in
`design.md`, not silently.

Implemented per
`openspec/changes/archive/2026-08-16-product-visual-redesign/`: design
tokens, application shell (branded sidebar + rounded
workspace container), shared primitives (`Button`, `FormField`, `Row`
column-grid mode, `ApproveRejectButtons`, `AuditEventRow`), and every
existing screen migrated to them (Dashboard, Attention Center, Quick
View, 360° Record, login, Audit Trail, Pipeline Detail, Project
Settings, Constitution, Configuration Center) — reaching beyond the
Dashboard used as the reference's visual example, per this slice's own
scope. Full existing E2E suite re-run clean against a fresh DB (one
pre-existing failure predating this change, verified via a throwaway
`git worktree` on the prior commit, and one already-documented
non-idempotent-test-design gap from Slice 9 — neither a regression
from this change; see `tasks.md`'s Task Group 14 for detail).

### Slices 11–21 — Product Vision & Flow Blueprint

*(Source: `docs/roadmap-sources/2026-08-16-product-vision-blueprint.md` — a
multi-turn conversation on 2026-08-16 that analyzed the HTML mock against
the current implementation, produced a full gap analysis, then a
consolidated end-to-end product vision (Client → Repositories → Project →
SDD discovery → relevance → decomposition → approval → assignment →
AI/developer recommendation → model selection → dependency/parallel
execution → questions/blockers → Git → evidence → completion → full
visibility), refined by nine user clarifications and five final resolved
decisions. Explicitly approved by the user as the target direction before
any of these slices is scoped further. The source file is authoritative;
this is a summary index only.)*

The vision is one coherent product direction, deliberately broken into 11
independently-scoped, dependency-ordered slices (per this project's
one-change-per-slice convention and CLAUDE.md's "prefer several small
changes" rule) rather than one large change:

**Slice 11 status:** Done. Implemented the shared `InfoTooltip` component
(`src/components/ui/InfoTooltip.tsx` — click/Enter/Space/hover to open,
Escape/click-outside/mouse-leave-without-a-pin to close, positioned via
logical CSS properties for automatic RTL mirroring) and adopted it once,
on Configuration Center's AI Budget field. Covered by two E2E specs
(`e2e/slice11-info-tooltip.spec.ts` for keyboard-only reveal/dismiss, and
an extension to `e2e/slice8-i18n-rtl.spec.ts` for RTL). One task
(a component-level unit test) was paused mid-implementation and resolved
by explicit user decision to skip, since this project has no
component-testing infrastructure yet (Vitest runs `environment: "node"`;
the existing suite is domain-layer only) — deferred as its own future
decision rather than bundled into this slice.

**Slice 12 status:** Done. Added `Repository.clientId` (backfilled via
`connectorId → connector.projectId → project.clientId`, then made
`NOT NULL`, per this project's three-step migration convention) and a new
`ProjectRepository` join table, so a repository is client-owned and
reusable across projects; `linkRepository` now finds-or-creates by
`(clientId, owner, name)` instead of by `connectorId`, and
`unlinkRepository` removes only the requesting project's link rather than
deleting a repository that may still be shared. Wired real Client CRUD end
to end — `updateClient`/`deactivateClient`/`reactivateClient` (the latter
added per explicit user instruction, alongside a matching
`tenancy` spec requirement, so Create/Edit/Deactivate/Reactivate are all
first-class) — with `POST/PATCH /api/clients`,
`POST /api/clients/[id]/{deactivate,reactivate}` routes and
`AddClientForm`/`EditClientForm`/`ClientActivationControl` UI (the latter
using Slice 11's `InfoTooltip` to explain what deactivation does and does
not do). Added the `/clients` hub (list + detail pages) and a "Clients"
NavRail entry, and excluded deactivated clients' projects from the
Dashboard and Attention Center (`listActiveClients`, plus a
`client.active` filter on `getItemsNeedingAttention`'s underlying
queries). Repository-creation decoupling (a repository connectable with
zero projects) stays out of scope, deferred to Slice 13 as proposed.
Covered by unit tests (`src/domain/client/commands.test.ts`,
`src/domain/evidence/commands.test.ts`'s reuse/unlink cases) and two new
E2E specs (`e2e/slice12-client-lifecycle.spec.ts`) for the full
create/edit/deactivate/reactivate lifecycle and cross-project repository
reuse; build, lint, and an RTL spot-check of both new pages all verified
live.

**Slice 13 status:** Done. Added `Connector.clientId` (same three-step
migration pattern as Slice 12's `Repository.clientId`) so a client's
connectors are queryable directly rather than derived via
`projects.map(p => p.connector)`; `getClientDetail` now reads them straight
from `clientId`. Expanded `IntegrationType` with five new closed-enum
values (`CRM`, `TEAMS`, `MCP`, `CUSTOM_API`, `OTHER`) naming the vision's
information-source categories — deliberately left unreachable through
`configureConnector`/`ConnectorConfigForm`, governed by the existing
"unimplemented connector type" `connector-management` requirement (now
modified to name them explicitly), since no real adapter exists for any of
them yet. No UI, route, or sync-engine change beyond that — `Connector`
stays 1:1 with `Project`, per the proposal's explicit non-goals. Covered by
new unit tests (`src/domain/client/queries.test.ts`) and verified live:
build, lint, a direct DB check confirming all nine enum values exist and
every `Connector.clientId` matches its project's client, and a browser
check confirming the connector-type selector still shows only the original
four options while the Clients hub's Connectors panel renders correctly
off the new query.

**Slice 14 status:** Done. Re-scoped 2026-08-18 (see below), implemented and
archived the same day. The old blueprint's one-paragraph scope (§5.3:
connect-time SDD check + bootstrap) is superseded by
`2026-08-17-core-product-definition.md` §8-13, which is far more detailed
and introduces System Context (§12-13) as a separate concept the old
blueprint never named — see the gap-analysis's Part 3 row for Slice 14.
As built: `RepositoryDiscovery` (versioned, evidence-cited findings, one
row per run) + a `DiscoveryStatus`/`RUN_REPOSITORY_DISCOVERY` `JobType`
addition; `fetchRepositorySnapshot` (bounded root-listing + README +
known-manifest fetch via the GitHub Contents API); `executeRepositoryDiscovery`
on both `AgentExecutor` implementations, Zod-validated the same way
`ANALYZE`'s findings are; `checkClientBudget` (client → organization,
no project tier) extending the existing budget-check pattern; the
`src/domain/repository-discovery/` domain layer
(`runRepositoryDiscovery`/`completeRepositoryDiscovery`/
`revertRepositoryDiscoveryFailure`, `getRepositoryContext`/
`listRepositoryDiscoveries`); a `worker.ts` handler reusing the existing
Job dispatch table; `POST`/`GET /api/repositories/[id]/discovery`; a new
`/repositories/[id]` detail page (linked from the Clients hub's existing
repository rows) showing the current context or an empty state with a
"Run Discovery" trigger, plus run history. Covered by new unit tests
across `github.test.ts`, `mockExecutor.test.ts`, `budget.test.ts`, and
`repository-discovery/commands.test.ts`, and a new E2E spec
(`e2e/slice14-repository-discovery.spec.ts`) against a stub GitHub server.
Verified live in-browser (admin and viewer roles) including the real
GitHub API integration's error/retry path (a deliberately invalid token
produced a genuine `401`, retried with backoff, then surfaced as a
`FAILED` run). Full suite green except one pre-existing
`slice5-engineering-evidence.spec.ts` failure, reproduced identically
against the pre-Slice-14 commit via a throwaway `git worktree` — not a
regression from this change. Bounded scope for this slice specifically
(deliberately smaller than all of §8-13, per CLAUDE.md's "prefer several
small changes" rule):

- New `RepositoryDiscovery` record: one AI-produced, versioned, evidence-cited
  structured analysis per `Repository` — purpose, stack, structure,
  modules/domains, APIs, data stores, testing approach, conventions,
  unknowns — each claim traceable to what was actually read in the repo, not
  inferred without evidence.
- New `RepositoryContext`: the current/queryable projection of the latest
  `RepositoryDiscovery` — surfaced on a repository's detail view (Clients
  hub) as a persistent, navigational summary. Explicitly labelled as a
  summary that can go stale, never presented as a substitute for reading the
  live source when a decision depends on it (source spec §10's own
  instruction).
- Trigger: an explicit, user-triggered "Run Discovery" action when a
  `Repository` is linked with no existing `RepositoryDiscovery` — not a
  silent automatic run on every connect, consistent with the product's
  existing pattern of AI spend always being an explicit choice (`Pipeline`'s
  explicit start, Slice 2) rather than implicit.
- Execution reuses Slice 3's `Agent`/`AgentRun`/`Job` infrastructure (retry,
  cost tracking, budget enforcement) and the AI-output → Zod schema →
  validation → domain-command discipline every other AI-writing path in this
  codebase already follows — not a new, unaudited execution path. This is
  the concrete reading of the governing principle below ("all AI execution
  goes through the same SDD pipeline... Slice 14's design must extend the
  existing pipeline rather than invent a parallel one"): Discovery is
  repository-scoped, not work-item-scoped, so it cannot literally attach to
  a `WorkItem`'s `Pipeline`/`Stage` state machine — what it must and does
  reuse is that machinery's *execution discipline* (Agent routing, `Job`
  durability, schema-validated output, audited writes), not the `Pipeline`
  row itself. Recorded here explicitly per CLAUDE.md's "never silently
  invent a product decision" rule, for the OpenSpec proposal to carry
  forward.
- Explicitly out of scope for this slice (left for a later one, per the
  gap-analysis): System Context/Reconciliation (§12-13, cross-repository
  relationships — needs at least two Discovery-covered repositories to mean
  anything, and its own reconciliation mechanism); Context Maintenance
  (§11, detecting a source change and re-analyzing) — this slice produces
  one point-in-time Discovery per explicit trigger, not a change-watching
  system; the original "baseline Constitution for the existing codebase"
  framing from the old blueprint — Discovery produces its own structured
  record, not a `Constitution` row, since `Constitution` (Slice 2) is
  Project-scoped and this is Repository-scoped with no Project involved.

**Slice 15 status:** Done. Re-scoped 2026-08-18 (see below), implemented
and archived the same day. The old blueprint's one-line scope ("AI
recommends relevant repos/sources for a new Project/Task") is superseded
by `2026-08-17-core-product-definition.md` §14-27, per the gap-analysis's
own Part 3 row: "**Needs re-scoping** — now that Requirement placement is
resolved (Part 2, Decision 3: standalone or optionally linked to a
Project), its trigger point likely moves from 'creating a Project/Task' to
'Requirement Triage,' with the Project-linked case as one path through
it." Since §14-27 is itself "the single largest net-new area" (gap-analysis
Part 1) with nothing above Project/WorkItem existing today, this slice
built the `Requirement` entity first rather than continuing the old
Slice 15's narrower recommendation framing.

As built: a new `Requirement` model (client-owned via `clientId`,
`WorkItemType`-typed, optional `projectId` — standalone by default, per
Decision 3) plus a `RequirementStatus` enum (`OPEN`/`SDD_ACTIVE`/
`DECLINED`); the `src/domain/requirement/` domain layer
(`createRequirement`/`updateRequirement`/`declineRequirement`/
`startSddForRequirement`, `listRequirementsForClient`/`getRequirementById`),
write-gated the same `requireClientRole(ctx, clientId, WRITE_ROLES)` way
every other client-scoped command is; `POST`/`GET /api/requirements`,
`GET`/`PATCH /api/requirements/[id]`, `POST /api/requirements/[id]/decline`,
`POST /api/requirements/[id]/start-sdd`; a "Requirements" panel + form on
the Clients hub's existing client detail page, and a new
`/requirements/[id]` detail page with Start SDD/Decline actions. One
explicit "Start SDD" action materializes a Project (if the Requirement is
standalone, via `createProject`) + a root WorkItem (via `createWorkItem`)
under it and moves the Requirement to `SDD_ACTIVE` — reusing both commands
verbatim, no new execution path. It deliberately does NOT call
`startPipeline` as part of activation: a freshly created Project has no
approved Constitution yet, and `startPipeline` requires one, so Pipeline
start stays the existing, separate, Constitution-gated action
(`StartPipelineButton`) already used for every other WorkItem — this was a
correction made mid-implementation (the original plan called
`startPipeline` directly) once that constraint was found in
`src/domain/pipeline/commands.ts`. Covered by 13 new unit tests
(`src/domain/requirement/commands.test.ts`, against a real Postgres
instance — standalone/Project-linked activation, re-activation refusal,
cross-client Project rejection, and non-write-role refusal on every
mutating command) and a new E2E spec
(`e2e/requirement-lifecycle.spec.ts`, standalone Requirement → Start SDD →
Project + WorkItem materialize, verified live against the dev server).
Full suite: build/lint/typecheck clean, 346/346 unit tests passing, 19/21
E2E passing — the two failures
(`slice5-engineering-evidence.spec.ts`, `slice6-configuration-center.spec.ts`)
both reproduce identically at the pre-Slice-15 commit (`6de8c3a`), verified
via a temporary checkout to that commit and back; neither is a regression
from this change. Explicitly deferred to a later slice, per the change's
design.md: Requirement Triage (§16), Impact Discovery (§17 — absorbs the
old Slice 15's "recommend relevant repos" framing), Deep Requirement
Analysis (§18-20), AI Questions with evidence/options (§21), generalized
Pause-and-Resume (§22), external-source Requirement intake, the richer
multi-choice SDD Activation set (Continue-Without-SDD / Postpone /
Return-to-Discovery, §25-27), and Requirement revisioning (per Decision
5's standing deferral).

**Slice 18 status:** Done. Proposed and implemented 2026-08-18 as
`task-decomposition-materialization`, archived the same day. Per the
gap-analysis Part 3 row for Slice 18: "§26-27 (SDD → Authoritative Work →
Structured Platform Representation → Visual Work Graph) — strong match ...
**Still roughly accurate**, but should decompose from a Requirement's SDD
output once Requirement exists (Decision 3), not only from a WorkItem's
own pipeline." Requirement now exists (Slice 15, above) — its "Start SDD"
action creates a root WorkItem + Pipeline that flows through the standard
SDD pipeline like any other, so this slice was the direct next link:
turning an approved TASKS stage's drafted task list into real, assignable
child WorkItems, which is what actually completes the Requirement →
execution loop end to end.

As built: the TASKS stage's AI output (`src/lib/agents/claudeExecutor.ts`,
`mockExecutor.ts`) gains a structured, Zod-validated `taskDrafts` list
(`taskDraftsSchema`/`TaskDraftItem`, `src/lib/agents/types.ts`) alongside
its existing prose content — reusing ANALYZE's existing `AnalysisFinding`
structured-side-channel pattern verbatim (same `<!-- MARKER -->` +
schema + replace-on-redraft discipline), not a new mechanism; a new
`TaskDraft` model per drafted task, persisted by `completeStageDraft`'s
existing TASKS-stage default branch
(`src/domain/pipeline/commands.ts`); the `src/domain/task-decomposition/`
domain layer (`materializeTaskDrafts`, `listTaskDraftsForStage`); one
explicit "Materialize" action, gated on the TASKS stage already being
approved (`status === "DONE"`, only reachable through its existing
approval gate — unchanged by this slice), that creates a real child
WorkItem for each selected draft via the existing `createWorkItem`
command; `GET`/`POST /api/stages/[id]/task-drafts{,/materialize}`; and a
`TaskDraftsPanel` on the Pipeline Detail page's TASKS stage card,
mirroring `AnalyzeFindingsPanel`'s conditional-render pattern exactly.
Covered by 7 new unit tests
(`src/domain/task-decomposition/commands.test.ts`, against a real
Postgres instance — drafts persisted and replaced on redraft,
materialization from a `DONE` stage, refusal from a non-`DONE` stage,
refusal of an already-materialized draft, refusal of an unknown draft id,
refusal of a read-only user) and a new E2E spec
(`e2e/task-decomposition.spec.ts`, driving a real pipeline through
SPEC→CLARIFY→PLAN→TASKS to an approved TASKS stage, materializing a
selected draft, and confirming it appears as a child on the parent's
360° Record). Full suite: build/lint/typecheck clean, 353/353 unit tests
passing, 19/22 E2E passing — of the three failures,
`slice5-engineering-evidence.spec.ts` and
`slice6-configuration-center.spec.ts` are the same pre-existing failures
already confirmed at the pre-Slice-15 commit, and the two additional
failures that appeared this run
(`slice12-client-lifecycle.spec.ts`'s second test,
`slice14-repository-discovery.spec.ts`) — both on an unrelated "Add
project" Dashboard flow this slice never touched — reproduced identically
at the pre-Slice-18 commit against the same accumulated local Postgres via
a temporary checkout, confirming environmental flakiness from this
session's many repeated E2E runs rather than a regression. Explicitly
deferred: the full cross-item Visual Work Graph (Slice 16, separate),
recursive/nested decomposition, and a generic Child/Bulk Approval pattern
(§51-52) beyond simple multi-select.

**Slice 16 status:** Done. Proposed and implemented 2026-08-18 as
`project-wide-planner`; archived to
`openspec/changes/archive/2026-08-18-project-wide-planner/`, delta spec
synced into `openspec/specs/project-planner/spec.md`. Per the gap-analysis
Part 3 row for Slice 16: "§31 (Visual Work Graph) — close conceptual
match ... **Still roughly accurate, extend field set** — least disrupted
of the eight [old blueprint slices]." Chosen as the next slice over Slice
17 (AI Recommendation card) because Slice 17's own gap-analysis assessment
says it "should incorporate Blocker criticality (§35) and Execution
Readiness (§34) once those exist" — neither exists yet (Blocker severity
deferred per Decision 7; Execution Readiness doesn't exist at all) — while
Slice 16 has no such blocking dependency and extends a component
(`DependencyGraph.tsx`) that's already fully built: layered-layout,
pan/zoom, and focus/highlight, today scoped to one WorkItem's neighborhood
inside the 360° Record.

Built: `getProjectWorkGraph(ctx, projectId)` in
`src/domain/dependency/queries.ts` — every WorkItem in a project plus
every `Dependency` edge among them (same BFS-with-cap discipline, sharing
`MAX_GRAPH_NODES`, as the existing per-item query), with a computed
`readyToStart` flag per node (OPEN/IN_PROGRESS status, every upstream
dependency already COMPLETED/CLOSED) as the "parallel-safe-task
explanation" — access-gated the same way (`requireClientRole(ctx,
project.clientId, ALL_ROLES)`), 9 unit tests covering full node/edge
return, ready-with-no-deps, blocked-by-unresolved-dependency,
ready-once-resolved, never-ready-off-OPEN/IN_PROGRESS, read-only viewer
access, and outsider refusal. A new `/projects/[id]/planner` page renders
`PlannerView` (client-side Graph/Board toggle): the Graph view reuses
`DependencyGraph.tsx` via a new optional `readyIds?: Set<string>` prop
(green ring + legend entry when set; the existing single-item Dependencies
tab call site omits it and renders unchanged) rather than literal
zero-modification, since task 2.2 required visually marking
`readyToStart` nodes; the Board view is a new `PlannerBoard.tsx`
component, one status lane per populated `WorkStatus` value, read-only
cards linking to the item's 360° Record with a "● Ready" badge — no
drag-and-drop status editing, which stays the existing status-change
action's job. "Planner" links added to the Dashboard's project card and
Project Settings page. E2E spec
(`e2e/project-wide-planner.spec.ts`) creates two WorkItems with a
dependency between them, verifies the Graph view renders both and shows
the "Ready to start" legend, switches to Board view, confirms status-lane
grouping and that the unblocked item is marked ready while the blocked one
is not, and confirms a card click opens the 360° Record — passing. Full
suite: 360/360 unit tests passing; build, lint, and typecheck clean. Full
E2E suite: 17 passed, 6 failed — the two known pre-existing baseline
failures (`slice5-engineering-evidence.spec.ts`,
`slice6-configuration-center.spec.ts`) plus 4 more
(`slice12-client-lifecycle.spec.ts`, `slice14-repository-discovery.spec.ts`,
`slice4-connector-framework.spec.ts`, `slice8-i18n-rtl.spec.ts`) verified
via the same temporary-checkout method used for Slices 15/18 to reproduce
identically at the pre-Slice-16 commit against the same accumulated local
Postgres — confirmed environmental flakiness from this session's many
repeated E2E runs, not a Slice 16 regression. Live-verified in the browser:
a project with an unresolved dependency correctly shows the blocked item
without the "ready to start" ring/badge in both Graph and Board views,
while its unblocked dependency and an independent item both show it.
Explicitly deferred: critical-path computation (the existing
`getCriticalPath` stub has been a documented TODO since Slice 2);
hierarchy/`parentId` edges in the graph (stays Dependency-only, matching
the gap-analysis's own note that Hierarchy vs. Dependency separation is
already correct and shouldn't be conflated); the new product definition's
Owner/Decision-Owner/Approval/Tests/Changes graph overlay (Decision-Owner
and Change history don't exist yet in this codebase per Decision 5's
standing deferral, so they can't be overlaid regardless).

**Slice 19 status:** Done. Proposed and implemented 2026-08-18 as
`cascading-task-assignment`. Per the gap-analysis Part 3
row for Slice 19, this was flagged "Needs re-scoping — should likely be
reframed as the general Responsibility Transfer mechanism §23 describes,
with cascading assignment as one instance of it." §23 of
`2026-08-17-core-product-definition.md` is a one-paragraph principle
("Authorized users may transfer: Ownership, Decision Ownership — during
the lifecycle of: Project, Initiative, Requirement, Feature, Bug, Task,
Subtask, Change") spanning entity types that don't exist yet (Initiative,
Feature, Change) and a Decision Ownership concept with no current
equivalent. The old blueprint's §5.6 is the only source with concrete
mechanism detail and its scope — Project → Task (WorkItem) *executor*
assignment specifically, not `ownerId` (a separate, already-specified,
always-defaults-to-creator concept) — is a buildable subset of §23's
broader scope. Chosen as the next slice over 17/20/21 after research
confirmed it's the most grounded of the four remaining: Slice 17 still
blocked (needs Blocker criticality/Execution Readiness, neither exists);
Slice 20 needs a wholly new scheduling primitive invented from scratch (no
cron/recurring-job mechanism exists — the Job runtime is claim-based/
on-demand only); Slice 21 requires inventing four entirely new domain
concepts (evidence rules, test rules, branch/PR policy, source mapping)
before generalization work can even start. Slice 19 needs only one new
concept — a Project-level default executor — reusing WorkItem's
already-real `executorType`/`executorId` fields (default `UNASSIGNED`, a
genuine "nobody assigned" state) at the task level. Bounded scope (see the
change's design.md for the full decision log): `Project.defaultExecutorType`/
`defaultExecutorId`; a new `WorkItem.assignmentSource`
(`EXPLICIT`/`INHERITED`) flag; a Preview→Confirm cascade flow (modeled
UX-wise, not code-wise, on Configuration Center's existing pattern) with
two explicit options and no default pre-selected — apply only to
inherited/unassigned WorkItems, or also reassign explicit ones.

Built: schema migration adding `Project.defaultExecutorType`/
`defaultExecutorId` and `WorkItem.assignmentSource` (defaults to
`INHERITED`, backfilling every pre-existing WorkItem — a no-op until a
project lead sets a default for the first time). `createWorkItem` inherits
the Project's default when no explicit executor is given;
`updateWorkItem` flips `assignmentSource` to `EXPLICIT` on any direct
executor edit — symmetric with how a cascade sets it back to `INHERITED`.
New `previewAssignmentCascade`/`applyAssignmentCascade` domain commands
(`src/domain/project/commands.ts`), both `WRITE_ROLES`-gated (a read-only
user can't even preview a cascade they can't apply); `applyAssignmentCascade`'s
`option` parameter has no default at the Zod-schema level — the API
boundary itself refuses to guess, not just the UI. Two new API routes
(`/api/projects/[id]/default-executor` and its `/preview` sibling) and a
new "Default Executor" panel on Project Settings
(`DefaultExecutorForm.tsx`) implementing the Preview→Confirm flow: two
neutrally-styled buttons ("Apply to unassigned only" / "Reassign
everyone"), neither visually emphasized as a default. 14 unit tests (7 on
`createWorkItem`/`updateWorkItem` assignment behavior, 7 on
preview/apply) all passing. E2E spec
(`e2e/cascading-task-assignment.spec.ts`) sets an explicit executor on one
WorkItem, leaves another unassigned, cascades a new default with "apply to
unassigned only" (verifies only the unassigned item moved), then cascades
again with "reassign everyone" (verifies the previously-explicit item
moved too) — passing, stable across repeated runs. While writing it,
found and fixed a real bug: the test's own premature navigation right
after a cascade-confirm click raced the in-flight POST and aborted it
server-side — not a Slice 19 domain bug, a test-timing bug, fixed by
waiting for the form to reset (which only happens after the POST
resolves) before navigating away. Live-verified in the browser: the
Preview step correctly lists an unassigned item under "will move
automatically" and an explicit item under "has its own explicit
assignment — untouched unless you choose to reassign," and the panel
reflects the new default immediately after applying. Full E2E suite: 18
passed, 6 failed — the two known pre-existing baseline failures plus two
already-confirmed-environmental-flakiness failures from Slice 16's
verification, plus two that needed real attention:
`slice4-connector-framework.spec.ts` had a genuine regression (the new
Default Executor `<select>` made its generic `page.locator("select")`
ambiguous — fixed by scoping the pre-existing test to
`getByLabel("Type", { exact: true })`; a second, separate pre-existing
QuickViewDrawer hydration flake in that same spec remains, unrelated to
Slice 19); `slice8-i18n-rtl.spec.ts` was verified via the same
temporary-checkout method as prior slices to reproduce identically at the
pre-Slice-19 commit, confirming environmental flakiness rather than a
regression. `e2e/cascading-task-assignment.spec.ts` itself passed on every
run.

Explicitly deferred: `ownerId` cascade/assignment (separate concept,
untouched); Decision Ownership transfer and any entity type beyond
Project/WorkItem (§23's full scope); generalizing Configuration Center's
`ConfigChange` machinery itself (Slice 21's job).

**Slice 17 status:** Done. Proposed and implemented 2026-08-18 as
`ai-recommendation-card`. Previously assessed this
session as "blocked" on Blocker criticality (§35) and Execution Readiness
(§34) not existing yet — re-reading the actual sources corrected that:
the blueprint's own definition of the card (§4/§5.7 — What/Why/
Assumptions/Estimated time/Estimated cost/What happens under each
alternative/a single override action) never mentions either concept, and
§34/§35 in `2026-08-17-core-product-definition.md` are unrelated concepts
about different entities (§34 = whether a work item is executable at all;
§35 = `Blocker` row severity). The gap-analysis's note that the card
"should incorporate [these] once they exist" was a future enrichment, not
a precondition — the same "build the concrete buildable subset now, defer
the rest" shape Slice 19 already established (deferring Decision
Ownership without waiting for it to exist). Chosen over Slices 20/21:
Slice 20 still carries more net-new surface (external fetch/parse, a new
model-snapshot entity, an `enqueueJob` signature change) even though its
scheduling concern turned out smaller than first assessed (the Job
runtime's existing `Job.scheduledAt <= now()` claim loop already supports
a self-requeue pattern); Slice 21 remains most speculative (four new
domain concepts with zero code today). Grounded in real signals already
in the codebase, not stubs: `WorkItem.risk`/`.priority`/`.type`/
`.executorType`; `AgentRun.costUsd`/`.promptTokens`/`.completionTokens`/
`.startedAt`/`.completedAt` (Slice 3); `Decision.aiRecommendation` as the
existing narrower pattern this generalizes. Bounded scope (see the
change's design.md for the full decision log): a shared
`AiRecommendationCard` component; a heuristic (not ML) AI-vs-developer
`recommendExecutor` function reading existing risk/priority/type plus a
new historical-cost-averaging query; always shows the AI-execution
estimate even when a developer is recommended; a single override action
with no default pre-selected, reusing the existing `updateWorkItem`
executor-assignment path — no new mutation route.

Built: `estimateExecutorCost(type, risk, priority)`
(`src/domain/agent/queries.ts`) averages `costUsd`/duration over
completed `AgentRun`s joined through the same `stageVersions → stage →
pipeline → workItem` path the existing cost-rollup queries use, falling
back from an exact type/risk/priority match to type-only to a global
average (implemented as global rather than the design's originally-worded
"org-wide" fallback, since the function takes no client/org-scoping
parameter — noted as a small terminology correction, not a scope change).
`recommendExecutor(ctx, workItemId)`
(`src/domain/recommendation/queries.ts`) applies a stated $5 cost
threshold plus a HIGH/CRITICAL-risk override to recommend AI or a
developer, always including the AI estimate either way, gated at
`ALL_ROLES` (read-only, informational). New `AiRecommendationCard`
component (self-fetching, matching the `QuickViewDrawer` client-island
pattern) renders on the Overview tab only for a `canManage` user viewing
a WorkItem with `executorType=UNASSIGNED`; "Assign to AI" calls the
existing `PATCH /api/work-items/[id]` directly, "Assign to a developer"
opens the existing `EditWorkItemForm` executor picker rather than
duplicating one. New `GET /api/work-items/[id]/recommendation` route. 15
new unit tests (8 on `estimateExecutorCost`'s fallback ladder, 7 on
`recommendExecutor`'s heuristic and access control) — written against
this session's real, accumulating shared test database using before/after
deltas rather than absolute values where prior history could dilute a
single assertion, the same discipline `getClientAiCost`'s own existing
test already uses. E2E spec (`e2e/ai-recommendation-card.spec.ts`)
creates a WorkItem with no executor, verifies the card renders with a
verdict/why/assumptions/AI estimate, clicks "Assign to AI", verifies the
executor updates and the card disappears — passing, stable across
repeated runs. Live-verified in the browser: the card showed a real,
non-fabricated estimate ("Based on 88 past run(s)...") drawn from this
session's own accumulated AI-drafting history, and the override action
correctly updated the Executor field and removed the card. Full E2E
suite: 19 passed, 6 failed — exactly the known set already confirmed
during Slices 16/19's verification (two pre-existing baseline failures,
four previously-confirmed environmental-flakiness failures), no new
failures.

Explicitly deferred: Blocker criticality/Execution Readiness as inputs;
AI model selection (Slice 20's job); estimating developer time/cost (no
existing signal for it); migrating other AI-facing surfaces (repository
relevance, decomposition, `Decision.aiRecommendation` itself) onto the
shared card.

**Slice 20 status:** Done. Proposed and implemented 2026-08-18 as
`ai-model-knowledge-snapshot`. Chosen over Slice 21 (Configuration
Center generalization to gates/evidence rules/test rules/branch-PR
policy/source mapping) — the latter requires inventing four undefined
product concepts with zero code or defined shape anywhere in this
codebase, a real product decision this proposal had no basis to make
unilaterally, while Slice 20's mechanisms (self-requeuing job via the
existing `Job.scheduledAt` claim gate, text-pattern extraction, the
`AiRecommendationCard` shape) all already existed in some form to
extend rather than invent from scratch.

Built: a new `ModelSnapshot` entity (`fetchedAt`, `status`
SUCCESS/FAILED, `rawContent` for debugging, `extractedModels` as
loosely-typed text fragments rather than strictly-parsed numeric fields
— deliberately, so a source-page redesign degrades to fewer/no
extracted models rather than a hard crash); a new self-requeuing
`FETCH_MODEL_SNAPSHOT` `JobType`, reusing the Job runtime's existing
`scheduledAt <= now()` claim gate (`enqueueJob` gained one new optional
`scheduledAt` parameter — no new scheduling infrastructure). Extraction
is deterministic text-pattern scanning
(`src/lib/integrations/modelKnowledgeSource.ts`) over the stripped page
text — not an AI call — since a call to extract "what AI costs" would
be circular and add its own budget/`AgentRun` bookkeeping for no clear
benefit; a model entry is kept only if a recognizable pricing or
context-window fact is found nearby, otherwise dropped, so a failed
extraction never becomes fabricated data. Unlike every other job type
in this codebase, `FETCH_MODEL_SNAPSHOT`'s `onExhausted` handler also
reschedules next Sunday's run (a deliberate, explicitly-documented
divergence — design.md Decision 4) — a transient source-page outage
must not silently end the weekly cadence. A `worker.ts`-startup
`ensureModelSnapshotJobScheduled()` call makes the cadence self-healing
across restarts/fresh environments without a one-time seed-script
entry.

`recommendModel` (`src/domain/model-snapshot/queries.ts`) resolves the
currently-configured default `Agent`'s model and **confirms** it using
the latest successful snapshot's facts (or flags it as possibly
deprecated/renamed if the snapshot no longer lists it) — deliberately
not a cross-model scoring/comparison engine, since no product-defined
criteria for "which model is objectively better" exist anywhere in the
blueprint and the product has exactly one configurable default model
today; inventing such scoring would have been an unscoped product
decision (design.md Decision 5, flagged and confirmed with the user
before implementation). Reuses Slice 17's `estimateExecutorCost` for
the cost/time estimate rather than computing a second, competing
estimate from the snapshot's raw pricing — exactly one cost-estimation
algorithm in the product. Falls back to the existing hardcoded
constants when no successful snapshot exists yet (e.g. immediately
after deploy, before the first Sunday run).

UI: `AiRecommendationCard` — previously hardcoded to Slice 17's
AI_AGENT/HUMAN executor-choice shape — was generalized into a `kind:
"executor" | "model"` component (an implementation necessity to fulfill
this slice's own "reuse the shared card" commitment and the
design-system spec's "duplicate status/action components are
consolidated" requirement, not scope invented beyond the proposal). The
model-recommendation instance renders on a WorkItem's Overview tab when
`executorType === "AI_AGENT"`, showing the confirmed model, why
(citing the snapshot's pricing/context-window facts when available),
assumptions, the reused cost/time estimate, and the snapshot's fetch
date as a freshness indicator — confirm-only, no override action, per
design.md's explicit non-goal. New `GET
/api/work-items/[id]/recommendation/model` route, gated `ALL_ROLES`
like Slice 17's route.

24 new unit tests (extraction parser fixtures covering a well-formed
page, no-recognizable-pricing, and no-models-at-all cases; job
scheduling — `nextSunday07UTC`'s Sunday-boundary edge cases,
`enqueueJob`'s new `scheduledAt` parameter, `ensureModelSnapshotJobScheduled`'s
idempotent-startup behavior; `recommendModel`'s confirm/staleness/
fallback paths and access control). Two new E2E scenarios
(`e2e/ai-model-knowledge-snapshot.spec.ts`): a snapshot-grounded
recommendation, and the no-snapshot-yet fallback — both seeded via a
standalone `tsx` fixture script
(`e2e/fixtures/seedModelSnapshot.ts`), since Playwright's own test
bundler cannot import the generated Prisma client directly (its ESM
`import.meta` usage fails under Playwright's transform) the way
`worker.ts` and every unit test already can. While implementing, found
and fixed a real regression this slice's own UI change caused in the
pre-existing `e2e/ai-recommendation-card.spec.ts`: it asserted the AI
recommendation card fully disappears after assigning a WorkItem to AI,
but a different card (the new model recommendation, sharing the same
`aria-label`) now legitimately renders in its place — narrowed the
assertion to confirm only that the executor-specific "Assign to AI"
button is gone.

Full verification: build, lint, and typecheck clean; 411/411 unit tests
passing. Full E2E suite: 21 passed, 6 failed — exactly the known
baseline set (`slice5-engineering-evidence.spec.ts`,
`slice6-configuration-center.spec.ts` confirmed pre-existing;
`slice12-client-lifecycle.spec.ts`, `slice14-repository-discovery.spec.ts`,
`slice4-connector-framework.spec.ts`, `slice8-i18n-rtl.spec.ts`
confirmed environmental flakiness earlier this session), no new
failures. Both `e2e/ai-model-knowledge-snapshot.spec.ts` scenarios and
the updated `e2e/ai-recommendation-card.spec.ts` passed.

Explicitly deferred: an admin-facing manual "run now" trigger for the
snapshot job (the weekly self-requeue alone satisfies this slice;
natural, separately-scoped follow-up); actually switching which
`Agent` executes a drafting run based on the recommendation (this slice
recommends/displays only — wiring the recommendation into
`resolveStageAgentId`'s actual selection deserves its own scoped
decision about override semantics); extracting capabilities beyond
pricing/context-window (tool-use support, vision) — decided against
during implementation since the source page's structure made them
meaningfully harder to extract reliably than pricing/context window.

### Slices 11–21 — Product Vision & Flow Blueprint

- **Slice 11** — a shared ⓘ info/explanation component. Zero dependencies;
  every AI-facing slice after it should be built to use it from the start.
- **Slice 12** — the foundational structural change: `Repository` becomes
  client-owned (not project-owned), with a `ProjectRepository` join for
  project-level selection; Client CRUD (`createClient()` already exists in
  code but is unreachable — no route, no UI) wired end-to-end; a new
  Clients hub page. Highest-leverage, highest-risk-because-structural;
  most later slices sit on top of it.
- **Slice 13** — broadens `Connector`/`IntegrationType` (today a closed
  `MANUAL | JIRA | AZURE_DEVOPS | GITHUB` enum, project-scoped) into a
  client-owned, expanded (still closed) enum covering the real range of a
  client's information sources.
- **Slice 14** *(re-scoped 2026-08-18 against `2026-08-17-core-product-definition.md`
  §8-13 and its gap-analysis Part 3 — see the dedicated status block below;
  this line is now a summary only, not the scope of record)* — Repository
  Discovery (a persistent, structured understanding of a repository: purpose,
  stack, structure, modules/domains, APIs, data stores, testing, conventions,
  unknowns, evidence) and Repository Context (the queryable, navigational
  artifact Discovery produces — explicitly not a substitute for live source
  verification), triggered when a repository is newly linked with no existing
  Discovery. System Context/Reconciliation (cross-repo relationships) and
  Context Maintenance (re-analysis on source change) are explicitly deferred
  to a later slice — see the status block below for why.
- **Slice 15** *(re-scoped 2026-08-18 against `2026-08-17-core-product-definition.md`
  §14-27 and its gap-analysis Part 3 — see the dedicated status block below;
  this line is now a summary only, not the scope of record)* — a
  `Requirement` entity foundation: client-scoped, standalone-or-optionally-
  Project-linked intake, with a single explicit "Start SDD" action that
  materializes a Project (if needed) and a root WorkItem from it. The old
  blueprint's "AI recommends relevant repos/sources for a new Project/Task"
  framing is deferred to a later slice as Impact Discovery (§17), now framed
  as a Requirement-scoped concern rather than a Project/Task-creation-time
  one — see the status block below for why.
- **Slice 16** *(proposed 2026-08-18 as `project-wide-planner` — see the
  dedicated status block below; this line is now a summary only, not the
  scope of record)* — the Planner: a project-wide dependency map +
  status-lane board (switchable), focus mode, and parallel-safe-task
  explanation. Extends `DependencyGraph.tsx`'s existing layered-layout/
  focus engine (today scoped to one item's neighborhood inside the 360°
  Record) to whole-project scope. Independent of 12–15; can proceed in
  parallel.
- **Slice 17** *(proposed 2026-08-18 as `ai-recommendation-card` — see the
  dedicated status block above; this line is now a summary only, not the
  scope of record)* — the shared "AI Recommendation card" pattern (what/
  why/assumptions/estimated time/estimated cost/what happens under each
  alternative), applied first to the AI-vs-developer executor
  recommendation, always including an AI-execution time/cost estimate even
  when AI isn't the recommended choice.
- **Slice 18** *(proposed 2026-08-18 as `task-decomposition-materialization`
  — see the dedicated status block below; this line is now a summary only,
  not the scope of record)* — materializes the SDD pipeline's existing
  `TASKS` stage artifact into real, individually-assignable child
  `WorkItem` rows behind an explicit selection step, distinct from the
  stage's own approval gate.
- **Slice 19** *(proposed 2026-08-18 as `cascading-task-assignment` — see
  the dedicated status block above; this line is now a summary only, not
  the scope of record)* — cascading Project→Task assignment that never
  silently overwrites an explicit task-level assignment: detects the
  conflict and presents the owner full context and every option, no
  default pre-selected, reusing Configuration Center's Preview→Confirm-
  impact pattern for the prompt itself.
- **Slice 20** *(proposed 2026-08-18 as `ai-model-knowledge-snapshot` —
  see the dedicated status block above; this line is now a summary
  only, not the scope of record)* — a weekly (Sunday 07:00) job that
  fetches and extracts model/pricing/capability information from
  `platform.claude.com/docs/en/about-claude/models/overview` into a
  structured, dated knowledge snapshot, and uses it to recommend which
  model should execute a given AI task and why — replacing any hardcoded
  model-cost assumption.
- **Slice 21** — generalizes Configuration Center's existing scope-
  inheritance + Preview→Confirm-impact pattern (real today, but AI-budget
  only) to the full field taxonomy identified in the vision (gates,
  evidence rules, test rules, branch/PR policy, source mapping, and the
  new recommendation factor weights).

Two governing principles apply across all eleven slices, not just one:
all AI execution goes through the same SDD pipeline — there is no separate,
lighter-weight execution path, so Slice 14/18's design must extend the
existing pipeline rather than invent a parallel one; and the SDD pipeline's
own transitions should follow OpenSpec's actual propose → apply → archive,
spec-anchored principles (the same ones this codebase's own development
already runs on), not a bespoke state machine.

### Slice 22 — Client "Tasks" section (top-level open work items) — **Done**

*(Source: `docs/roadmap-sources/2026-08-18-client-tasks-section.md` — a
standalone, ad hoc user request, not part of the Slices 11–21 blueprint
sequence.)*

Proposed and implemented 2026-08-18 as `client-tasks-section`. A new
"Tasks" panel on the Client detail page, listing every top-level
(`parentId IS NULL`) open (`status` not `COMPLETED`/`CLOSED`) `WorkItem`
across the client's projects, of any `WorkItemType`
(`PROJECT`/`TASK`/`BUG`/`CHANGE`) — a WorkItem with a parent (e.g. a Task
materialized under a PROJECT-type WorkItem) is excluded, even though its
ancestor is shown. Two clarifications resolved before scoping: "REQUIRED"
means any submitted work item (not a new field), and "Project" here means
a `WorkItem` of `type: PROJECT`, distinct from the page's existing
separate "Projects" panel (the `Project` model's own list, unaffected).

Built: `getClientDetail` (`src/domain/client/queries.ts`) gained a
`topLevelOpenWorkItems` field — `db.workItem.findMany({ where: { parentId:
null, status: { notIn: ["COMPLETED", "CLOSED"] }, project: { clientId } },
orderBy: { createdAt: "desc" } })`, reusing the exact "open" convention
`getHighRiskWorkItems`/`getUpcomingDeadlines` already established, rather
than inventing a new one — folded into the page's existing single
server-side fetch rather than a second round-trip. A new "Tasks" `Panel`
placed between the existing Requirements and Repositories panels, each row
showing title, a plain-text type/project label (mirroring the neighboring
Requirements panel's row shape exactly, since every other row on this page
is plain-text, not icon-based), and a `StatusBadge` linking to the item's
360° Record — a new `WORK_STATUS_TONE`/`WORK_STATUS_REASON` mapping was
added since no `WorkStatus`→`StatusBadge` tone convention existed anywhere
in the codebase yet.

9 new unit tests (`src/domain/client/queries.test.ts`): a top-level item
of every type appears; a child WorkItem is excluded even when its
top-level PROJECT-type parent is shown; a `CLOSED` top-level item is
excluded (`COMPLETED` wasn't exercised directly — it shares the same
`notIn` array-membership check, and reaching it requires satisfying the
unrelated evidence-driven completion policy from Slice 5); scoping is
correct across multiple projects under the same client and excludes
another client's WorkItems. New E2E spec
(`e2e/client-tasks-section.spec.ts`): seeds a project plus the full
WorkItem hierarchy fixture set via a standalone `tsx` fixture script
(`e2e/fixtures/seedClientTasksFixtures.ts`, through the real
`createProject`/`createWorkItem`/`updateWorkItemStatus` domain commands —
not raw DB inserts), then verifies the Tasks section shows exactly the
three eligible top-level open items and excludes the child and the closed
item.

While diagnosing why the fixture couldn't reliably go through the
Dashboard's own `AddProjectForm` UI, found and confirmed (via
request-body interception) a real, pre-existing bug unrelated to this
slice: selecting a client from that form's dropdown — when the client was
created earlier in the same test run — consistently causes the form's
`name`/`key` local React state to arrive empty on submit (`clientId`
correct, `name`/`key` `""`), even though the DOM's own input values read
correctly right up to the click. This matches this session's
already-documented, already-accepted QuickViewDrawer hydration-mismatch
flakiness pattern (React discarding and asynchronously remounting a
subtree, wiping local component state) rather than anything introduced by
this slice — confirmed not caused by this change, since `page.tsx` and
`AddProjectForm.tsx` were never touched. Left unfixed as out of scope;
the fixture script sidesteps the interaction entirely instead, matching
the precedent `e2e/fixtures/seedModelSnapshot.ts` (Slice 20) already set
for a UI path Playwright can't reliably drive.

Full verification: build, lint, and typecheck clean; 414/414 unit tests
passing. Full E2E suite: 22 passed / 6 failed (11.3m) — the 6 failures are
exactly the known baseline (`slice5-engineering-evidence.spec.ts` and
`slice6-configuration-center.spec.ts` are confirmed pre-existing failures;
`slice12-client-lifecycle.spec.ts`, `slice14-repository-discovery.spec.ts`,
`slice4-connector-framework.spec.ts`, and `slice8-i18n-rtl.spec.ts` are
already-verified environmental flakiness), with no new failures.
`e2e/client-tasks-section.spec.ts` passed.

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
