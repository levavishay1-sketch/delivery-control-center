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
