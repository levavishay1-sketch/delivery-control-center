# Product Vision & Flow Blueprint — Slices 11+ (source document)

*(Source: multi-turn conversation on 2026-08-16 — an HTML mock (`AI_Delivery_Control_Center_SDD_v7.html`)
was analyzed against the current implementation, followed by a detailed gap analysis, followed by
this consolidated vision blueprint, followed by 9 user clarifications, followed by 5 final answers
resolving every open question. The user gave explicit final approval: "you can start working on
everything you wrote. I approve it." This file is the agent's synthesis of that whole
conversation, confirmed by the user as the target direction — the same pattern used for
`2026-08-15-dashboard-motifs-direction.md` (Slice 9). Verbatim excerpts of the user's own words are
included in the Appendix for traceability. This document is authoritative for Slices 11 and
onward if any later summary drifts from it.)*

Every "Already exists" / "Missing" claim below was verified directly against the current schema,
domain commands, API routes, and UI — not assumed. Key verified facts: `Repository.connectorId`
and `Connector.projectId` are both `@unique` (rigid 1:1:1 Project↔Connector↔Repository chain);
`Project` has zero external-source fields; `IntegrationType` is `MANUAL | JIRA | AZURE_DEVOPS |
GITHUB` only; `createClient()` exists but is unreachable (no route, no UI); `StatusBadge` already
requires a `reason` prop; `DependencyGraph.tsx` already implements layered-layout + focus/dim, but
scoped to one item's BFS neighborhood inside the 360° Record only.

---

## 1. Product vision, in one paragraph

Delivery Control Center is the single place a delivery manager watches and steers software work
across every client, without reading code or babysitting tools directly. A **Client** is a company
we serve; it owns a standing pool of **Repositories** and a broad set of **information sources**
(work trackers, CRM, chat, MCP, anything relevant) — independent of any Project, and independent of
whether a Project currently uses them. A **Project** can be created natively or arrive from an
external system, and draws on the subset of the Client's repositories and sources relevant to it.
The moment a Repository is first connected — before any Project or Task ever touches it — the
system checks whether it already has SDD in place and, if not, begins bootstrapping SDD on the
existing codebase, so every future task starts from real context instead of a cold scan. New work
enters as a Project or Task, gets AI-decomposed into reviewable subtasks wherever SDD principles
call for it (not restricted to Projects), and every unit of work — Project, Task, or Subtask — is
assignable to a developer or to AI **interchangeably and reversibly at any time**, by whoever
currently holds it. Whenever AI is a candidate executor, the system states its estimated time,
estimated cost, recommended model, and reasoning up front — even if the manager overrides AI's own
recommendation. All AI execution follows the same SDD principles; there is no separate,
lighter-weight execution path that bypasses them. Dependencies and parallel-safe work are made
visible and explained, never left for the reader to infer. Every blocker, AI question, and
recommendation surfaces to the owner as one actionable item with full context, assumptions, and
every available option — the owner decides, AI never picks a default on their behalf. Every task's
full story — spec, plan, code, PR, tests, evidence, done — is inspectable end to end, for one task
or an entire project at a glance. The SDD progression itself is not a bespoke invention; it follows
the same propose → apply → archive, spec-anchored principles that OpenSpec — and this very
product's own development process — is built on.

---

## 2. Target information architecture (sidebar)

| Nav item | Today | Target |
|---|---|---|
| Dashboard | Exists | Extended — §6.1 |
| Attention Center | Exists, real query-backed | Extended with new categories — §6.1 |
| **Clients** (hub) | Missing entirely | New: client cards → detail (projects, repositories, information sources) |
| **Planner** (task flow) | Missing as a page; only a per-item BFS graph exists inside 360° Record | New: dependency map + status board + parallel-safe grouping + focus mode |
| All Work / Tasks | Only per-project lists on the Dashboard | Consider a flat, filterable table across projects |
| Audit Trail | Exists, real | Unchanged |
| Sources & Sync | Exists (project-scoped connectors) | Reframed as **Client-owned information sources**, broader than Jira/ADO — §3, §5.7 |
| Configuration Center | Exists, budget-only | Generalized to the full field taxonomy — §6.3 |
| Command Palette | Indexes work items + projects | Extended to clients, repositories, commits, PRs |

---

## 3. Target data model additions (conceptual — not a migration doc)

**Repository — client-owned, project-independent.** Today `Repository` is 1:1 with `Connector`,
which is 1:1 with `Project` — a repository cannot exist without a project. Target:
`Repository.clientId` FK, directly on `Client`. A repository can exist under a client with **zero**
projects linked to it. `ProjectRepository` join (new, many-to-many) is how a Project
selects/links relevant repositories from the client's pool — never the other way around.

**Information sources — an expanded, closed enum, client-owned. [Resolved — see Appendix Q3]**
Today `Connector` is scoped 1:1 per **Project**, and `IntegrationType` is a narrow enum
(`MANUAL | JIRA | AZURE_DEVOPS | GITHUB`). Target: the owning concept is the **Client**, not the
Project. `IntegrationType` grows into an **expanded enum** covering the real range of sources a
client needs (work trackers, CRM, chat/Teams-type tools, MCP, custom API, manual, etc.) —
explicitly **not** a fully open/admin-defined taxonomy. A Client has a collection of these sources;
a Project links the relevant subset, the same pattern as repositories above. The system determines
which of a client's sources can answer a given information need and uses them.

**`RepositoryDiscovery` / SDD-bootstrap status (new).** One row per Repository. Not just a
read-only summary — it tracks whether SDD has ever been implemented for that repo, and if not,
that a bootstrap SDD pass (producing an initial Constitution/spec baseline for the *existing*
codebase) has been triggered. Fields: `sddStatus` (`not-checked` / `checking` /
`not-implemented` / `bootstrapping` / `implemented` / `stale`), the structured discovery summary
(languages, frameworks, key components), `discoveredAt`. This check-and-bootstrap happens the
moment a repository is first connected — independent of any Project or Task — not lazily on first
use.

**`Project.origin` (new).** `Project` currently has no external-source fields at all. Target: a
Project can be created natively in DCC *or* arrive via sync/import from an external system,
mirroring the `source`/`externalId`/`syncedAt` pattern `WorkItem` already has.

**`WorkItem.assignmentSource` (new).** Distinguishes `explicit` (someone deliberately set this
item's executor) from `inherited` (received it from a parent's cascading assignment). This is what
makes the assignment-conflict flow (§5.6) possible.

**Reassignment is symmetric and always available.** No new entity — a statement about
`executorType`/`executorId` mutation rights: any work item assignable to AI must be assignable to
a developer and vice versa, at every level (Project/Task/Subtask/any executable item), not just at
creation. Whoever currently holds an item can reassign it again, to another developer or to AI.

**`AiExecutionEstimate` (new).** A required *shape* attached to every AI-execution recommendation
and every manager choice to use AI: estimated time, estimated cost, recommended model + reasoning.
Computed whenever AI is a candidate — including when the manager overrides an
AI-recommends-developer outcome and picks AI anyway. Applies at Project level too (aggregate
estimate), not only per-task.

**`AiModelKnowledgeSnapshot` (new — source and cadence resolved, see Appendix Q1).** Source of
truth: `https://platform.claude.com/docs/en/about-claude/models/overview`. A weekly job (every
Sunday at 07:00, reusing the existing Job runtime — Slice 2 — no new execution infrastructure)
fetches and extracts: available models (including new/changed ones), pricing, token economics,
context limits, capabilities, recommended use cases, and any other information relevant to model
selection and AI execution planning — into a structured, dated snapshot. Model recommendations
(§5.8) read this snapshot and can explain *why* a model is currently the best choice, citing what's
known as of the last refresh, rather than relying on hardcoded information that goes stale.

---

## 4. Cross-cutting pattern: the "AI Recommendation" card

Every place AI proposes something — repository relevance (§5.4), decomposition (§5.5), executor
choice (§5.7), model choice (§5.8) — should produce the **same shape** of recommendation, not a
bespoke UI per feature:

- **What** AI recommends
- **Why** (reasoning, in plain language)
- **What assumptions** were used
- **Estimated time**, when execution is involved
- **Estimated cost**, when AI execution is a candidate — always shown, even if AI ends up not
  being the manager's final choice, and always shown if the manager picks AI despite a
  developer recommendation
- **What happens under each alternative** ("if you assign to a developer instead...", "if you
  keep the current model instead...")
- A single, consistent override action — the manager's choice is never blocked by AI's opinion

This is the same shape `Decision.aiRecommendation` and the pipeline gate-decision UI already use
today — the target is to make it the **one** recommendation pattern product-wide, paired with the
ⓘ explanation primitive (§6.5).

**Owner-decides principle for conflicts [Resolved — see Appendix Q5]:** whenever the system
surfaces a significant conflict or problem (not just an AI recommendation) — e.g. §5.6's
project-vs-task assignment conflict — it presents full context and every available option and lets
the owner decide, with **no pre-selected default**. This applies as generally as the AI
Recommendation card does.

---

## 5. End-to-end lifecycle blueprint

### 5.1 Client foundation
Clients hub → client detail page (projects, repositories, information sources together).
`createClient()` exists but is unreachable — no route, no UI, no edit beyond budget, no
delete/deactivate (no such schema field). Foundational to nearly everything below.

### 5.2 Client's repository pool
A Client's repository list is manageable independent of any Project — repos can sit unused in the
pool. Requires the client-owned `Repository`/`ProjectRepository` model (§3); today repos only
exist as a side effect of a project's single connector. Depends on §5.1.

### 5.3 Repository connection → SDD status check → bootstrap
The moment a repository is connected, the system checks for existing SDD and, if absent, begins an
actual bootstrap pass — a retroactive Constitution/spec baseline for the *existing* codebase — with
**no Project or Task involved at all**. Reuses the Constitution draft/approve mechanism already
real in Slice 2. This is governed by the SDD-alignment principle in §7 — it is not a separate,
bespoke progression. Depends on §5.2.

### 5.4 Relevant-repository (and source) recommendation
An AI Recommendation card (§4) suggests relevant repos/sources for a new Project/Task, scored
against each source's *already-discovered* context (never a fresh scan), always overridable by
full manual selection. Depends on §5.3.

### 5.5 Project/Task/Subtask definition → AI decomposition → owner approval [scope resolved — Appendix Q4]
A Project can be created natively **or arrive via import/sync** (`Project.origin`, §3). AI
decomposition is **not restricted to Projects** — it applies to any Work Item where SDD principles
call for it, evaluated the same way the existing SDD-activation policy already decides whether a
work item warrants the full pipeline (Slice 2), not an artificially separate rule. When decomposed,
proposed subtasks (with inferred dependencies) are reviewed and explicitly approved before any
child `WorkItem` row is created — the existing `TASKS` stage produces a real, gated artifact today;
what's missing is materializing it into real, individually-assignable work items.

### 5.6 Assignment — symmetric, reversible, and conflict-aware
Any Project/Task/Subtask is assignable to a developer or AI at any time, and reassignable again
later by whoever currently holds it — not a one-shot decision. Project-level reassignment must
never silently overwrite a task's **explicit** assignment: the system detects the conflict and
surfaces it to the owner with full context and every option (move existing tasks to the new
assignee, or keep their explicit assignments and apply the new one only to the Project and
unassigned tasks) — **no default pre-selected** (Appendix Q5). Cascades automatically only over
tasks without an explicit override. Needs `assignmentSource` (§3) and a new conflict-detection
flow, modeled UX-wise on Configuration Center's existing Preview→Confirm-impact pattern (§6.3).

### 5.7 AI vs. Developer recommendation, with estimate
An AI Recommendation card (§4) on any unassigned unit of work, always including estimated time and
cost for the AI-execution option even when AI recommends a developer, so the manager can compare
before overriding. Entirely new scoring + estimate engine; benefits from but isn't blocked by
§5.3/§5.4 repo context.

### 5.8 AI model selection, powered by the weekly knowledge snapshot
When AI is the executor, which model is proposed and why, citing current pricing/capability/
context-limit facts from the snapshot (§3), with its freshness visible. `Agent`
registry/`AgentRun` cost tracking (Slice 3) already handle consumption; the catalog + weekly
fetch + recommendation logic are new.

### 5.9 Dependencies & parallel execution
Parallel-safe task groups are labeled with why ("no shared dependency"); blocked tasks show inline
why/what/who/what's-needed. The "why blocked" half is already real (`Blocker.reason`,
`DependencyGraph.tsx`'s chain computation); "why parallel-safe" is pure derivation over existing
data, no new entities. Depends on §5.13 to be meaningful at scale.

### 5.10 Questions / blockers during execution [path resolved — Appendix Q2]
An AI question surfaces in Attention Center exactly like a blocker or decision — mirroring how
Claude Code itself surfaces a question. **All AI execution goes through the full SDD pipeline —
there is no separate execution path that bypasses it** (this was an open question in the prior
draft; now resolved). This means the existing `ClarifyQuestion` mechanism (today scoped to the
pipeline's `CLARIFY` stage) is the *right* mechanism, not a narrower special case to be
generalized around — any AI-executed unit of work asking a question does so through the same
pipeline stage, consistent with §7's "don't invent a separate progression" principle.

### 5.11 Git / PR / commit tracking
Fully real today (Slice 4/5) — only the *ownership* of `Repository` moves (§3), not what's
tracked. No functional gap.

### 5.12 Testing, Evidence & Completion
Fully real and server-enforced today (Slice 5) — no gap identified.

### 5.13 Full project & task visibility — the Planner
Project-wide dependency map + status-lane board, switchable; focus mode (click a task → highlight
its full chain, dim the rest, auto-scroll); "open map, focused here" reachable from Attention
Center, Dashboard, and Quick View. The layered-layout + focus/dim engine already exists
(`DependencyGraph.tsx`) but is scoped to one item's BFS neighborhood inside the 360° Record only.
Missing: a dedicated project-scoped page, the status-board alternate view, the cross-surface deep
link, and (§5.9) parallel-group + blocked-reason annotations on the cards themselves. This is the
mock's strongest, most fully-realized idea.

---

## 6. Cross-cutting systems

### 6.1 Manager Dashboard & Attention Center
Already covers decisions, blockers, risks, deadlines, approval gates, paused clarifications, sync
conflicts. Missing categories: AI cost/budget issues, failed tests/builds, a "ready to execute"
queue, dashboard-wide Git/PR activity, pending repository/project/source decisions (once §5.2–5.4
exist).

### 6.2 Command Palette
Today: work items + projects. Target: clients, repositories, information sources, commits, PRs.

### 6.3 Configuration Center — generalized, and the model for §5.6's conflict UX
Real scope-inheritance + Preview→Confirm-impact today, budget-only. Target: the same per-field
pattern (effective value, inherited-vs-override tag, revert action, ⓘ explainer, impact preview)
generalized to gate approvers, evidence rules, test rules, branch/PR policy, connector/source
mapping, and the new §4/§5.7/§5.8 recommendation factor weights. Also the right model for §5.6's
conflict prompt: same shape, new domain.

### 6.4 360° Delivery Record
Real tabs today: Overview, Dependencies, Timeline, Code & Changes, Tests, Evidence. Add: a compact
SDD tab (stage stepper, inline pending Clarify/Gate) and a Config tab (effective rules governing
this specific item, linking into §6.3 pre-scoped).

### 6.5 Info / ⓘ explanation pattern
`StatusBadge` already requires a `reason` — status is never unexplained. Missing: a generic,
reusable info/tooltip primitive (zero exist in `src/components/ui` today) — the natural carrier
for §4's "why/assumptions" detail without cluttering the primary card.

---

## 7. SDD pipeline progression is OpenSpec-shaped, not bespoke

The existing 7-stage pipeline (Constitution → SPEC → Clarify → Plan → Tasks → Analyze →
Implement) already resembles a change-management lifecycle. Per explicit instruction: don't invent
a separate progression model — align with OpenSpec's real principles, the same ones this
codebase's own development already runs on (`openspec/`, `CLAUDE.md`'s "OpenSpec is mandatory"
section). This governs §5.3's bootstrap, §5.5's decomposition, and §5.10's confirmed
"no-separate-execution-path" resolution:

- **propose → apply → archive** as the shape of how a unit of SDD work moves from drafted intent
  to reviewed, applied change to a finalized, archived record.
- **Spec-anchored, not spec-once**: a repository's/project's SDD artifacts must keep matching
  reality; discrepancies get fixed, not left to drift — the same discipline `openspec validate
  --strict` enforces on this repo.
- **Delta-based change tracking** (ADDED/MODIFIED/REMOVED/RENAMED requirements) as the candidate
  model for how a repo's or project's SDD understanding evolves incrementally.
- **Validation gates**: the `ANALYZE` stage is already conceptually `openspec validate` for a work
  item's own artifacts.
- **All AI execution goes through this pipeline** (§5.10) — confirmed, not a separate path.

---

## 8. Mock UX patterns — preserve/adopt checklist

| Pattern | Where it applies | Status |
|---|---|---|
| Project-wide dependency map, layered layout | §5.13 Planner | Engine exists, scope too narrow |
| Status-lane board (same data, alt. view) | §5.13 Planner | Missing |
| Focus mode: highlight chain, dim the rest | §5.13 Planner | Exists, item-scoped only |
| Inline "blocked by X" / "parallel-safe" on cards | §5.9, §5.13 | Missing on cards |
| Plain-language dependency explanation list | §5.13 | Missing |
| "Open map, focused here" deep link | Everywhere a task appears | Missing outside its own record |
| Client hub → detail (repos+sources together) | §5.1, §5.2 | Missing entirely |
| Config field: value + source tag + revert/override + ⓘ | §6.3, reused for §5.6 | Pattern exists for budget only |
| Impact preview before save / before cascade | §6.3, §5.6 | Exists for budget only |
| Repository as first-class, browsable, client-owned entity | §5.2 | Missing (currently project-owned) |
| Expanded information-source taxonomy per client | §3, §5.4 | Missing (narrow 4-value enum today) |
| Two-step "New Work" (type → source/context) | §5.5 | Exists, extend with repo/source picker |
| SDD-engine / model as a visible, swappable, explained choice | §5.8, §6.3 | Missing |
| Compact SDD stepper inside the record drawer | §6.4 | Missing (full page only) |
| ⓘ info icon everywhere non-obvious | §4, §6.5 | Missing as reusable primitive |
| AI Recommendation card (what/why/assumptions/time/cost/alternative) | §4, everywhere AI proposes | New synthesis, consistent with mock's `Decision.aiRecommendation`-style cards |

---

## 9. Dependency ordering between capabilities

1. **§5.1/§5.2 Client + client-owned Repository/Source model** is foundational.
2. **§5.3 SDD-on-connect bootstrap** depends on §5.2, feeds §5.4.
3. **§5.4 relevance recommendation** depends on §5.3.
4. **§5.5 decomposition, §5.6 assignment, §5.7 AI/dev recommendation+estimate, §5.9 parallel
   explanation** are largely independent of §5.1–5.4 — operate on data that exists today, improve
   with repo/source context but aren't blocked by it.
5. **§5.8 model selection** depends only on the weekly-refresh job (§3) existing.
6. **§5.13 Planner** is independent — an extension of existing, working code.
7. **§6.5 the ⓘ primitive** and **§4's AI Recommendation card** are cheap, zero-dependency, and
   everything AI-facing above should be built to use them from day one.
8. **§6.3 Configuration Center generalization** can start immediately for non-repo-scoped fields.
9. **§7's OpenSpec-aligned principle** governs §5.3 and §5.5's design specifically.

---

## 10. Candidate OpenSpec change sequencing → Slice numbering

Each item below becomes its own OpenSpec change / Slice, per this project's existing one-change-
per-slice convention (Slices 0–10) and CLAUDE.md's "prefer several small changes" rule.

| Slice | Change name | Scope | Depends on |
|---|---|---|---|
| 11 | `info-tooltip-primitive` | Shared ⓘ component (§6.5, §4) | — |
| 12 | `client-repository-model` | Client-owned `Repository`, `ProjectRepository`, Client CRUD wired end-to-end, Clients hub (§5.1, §5.2, §3) | — |
| 13 | `client-information-sources` | Broaden `Connector`/`IntegrationType` into a client-owned, expanded-enum source model (§3, §5.4 groundwork) | 12 |
| 14 | `repository-sdd-bootstrap` | Connect-time SDD status check + bootstrap pass, OpenSpec-aligned per §7 (§5.3) | 12 |
| 15 | `repository-relevance-recommendation` | AI recommends relevant repos/sources for new Project/Task (§5.4) | 14 |
| 16 | `project-wide-planner` | Dependency map + status board + focus mode + parallel-safe grouping, project-scoped (§5.9, §5.13) | — (can run in parallel with 12–15) |
| 17 | `ai-recommendation-card` | Shared recommendation-card + estimate shape (§4), applied first to executor recommendation (§5.7) | 11 |
| 18 | `task-decomposition-approval` | Materialize `TASKS` artifact into real, approvable child work items, for any qualifying Work Item (§5.5) | — (benefits from 12–15) |
| 19 | `cascading-assignment-with-conflict-detection` | Project-level assignment cascade + explicit-assignment conflict prompt, owner-decides with no default (§5.6) | 17 |
| 20 | `ai-model-knowledge-snapshot` | Weekly Claude-docs fetch job + model recommendation (§5.8, §3) | 17 |
| 21 | `configuration-center-generalization` | Extend beyond budget to the full field taxonomy (§6.3) | — (parallelizable) |
| 22 | (folded into 5.10's resolution — no separate slice) | Confirmed: no generalized non-pipeline AI-question path is built; §5.10 is satisfied by existing `ClarifyQuestion` once AI execution universally goes through the pipeline. | — |

This ordering is a starting proposal; some may merge, split, or reorder once each is actually
scoped via `/opsx:propose`.

---

## Appendix — verbatim user clarifications (for traceability)

**Q1 (Claude model knowledge source & cadence):**
> "There is an official and authoritative source: https://platform.claude.com/docs/en/about-claude/models/overview
> Once a week, every Sunday at 07:00, the AI should access this page and extract all relevant
> information about the models, including new models and changes, pricing, token economics,
> context limits, capabilities, recommended use cases, and any other information that could be
> relevant to model selection and AI execution planning. The goal is for the system to always
> maintain an up-to-date Knowledge Snapshot of Claude models rather than relying on hardcoded
> information that can become outdated."

**Q2 (does all AI execution go through the full pipeline):**
> "Yes. Follow the SDD principles. AI Execution should follow the same SDD principles and should
> not create a separate execution path that bypasses them."

**Q3 (information source taxonomy):**
> "`IntegrationType` should be an expanded Enum, not a completely open/custom-defined model. The
> Enum should be expanded to represent the range of information sources the system needs to
> support and should not remain limited to Jira / Azure DevOps / GitHub."

**Q4 (decomposition scope):**
> "Follow the SDD principles. Do not artificially restrict Decomposition to Projects only.
> Evaluate the work unit and the SDD requirements, and support Decomposition for any Work Item
> where it is appropriate according to SDD principles."

**Q5 (conflict modal default):**
> "There is no need to define a default option or prefer A or B in advance. As with any
> significant problem or conflict in the system, surface it to the OWNER, provide all relevant
> context and available options, and let the OWNER make the decision."

Earlier in the same conversation, the user also gave nine numbered clarifications (repository
ownership, symmetric AI/developer reassignment with time/cost estimates, project origin, SDD
bootstrap-on-connect, OpenSpec-aligned pipeline transitions, broad client information sources,
project/task assignment-conflict handling, and the general "AI recommends and explains, manager
stays in control" principle) — all incorporated into §§3–9 above.
