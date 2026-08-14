> **Provenance note (added by the agent when saving this file — not part of
> the original document):** Pasted into chat by the user on 2026-08-14, in a
> single message, in response to being asked for the underlying
> "Claude Code Master Prompt — AI Delivery Control Center.md" (the 70-section
> vision document referenced by section number throughout this file). This
> is that fuller document — "Gap Analysis & Implementation Prompt" — which
> contains, as its own Part 5, the same prompt already saved verbatim in
> `2026-08-14-master-prompt-gap-analysis.md`. This file supersedes that one
> as the primary source (it's a strict superset: the same Part 5, plus
> Parts 1–4 and 6 with the full 45-item gap register and reasoning this
> repo didn't have before).
>
> **Important — still not fully resolved**: this document is itself a
> *summary and gap analysis* of the real "Claude Code Master Prompt — AI
> Delivery Control Center.md" (70 sections), referenced throughout by
> section number (§4, §20, §26, §58, ...). That underlying 70-section
> document has still never been provided verbatim to this repository. This
> file gives more detail than before (e.g. it names 3 of the 9 `WorkStatus`
> states: `decision_required`, `blocked`, `review`) but does not fully
> specify every enum/field this document references. Where Slice 1 planning
> needs a value this document doesn't give, that gap is called out
> explicitly in `docs/ROADMAP.md` rather than invented silently.
>
> Content below this line is verbatim as received, unedited.

---

# Delivery Control Center — Gap Analysis & Implementation Prompt

**Inputs:** `Claude Code Master Prompt — AI Delivery Control Center.md` (the vision, 70 sections) and `PRODUCT_SPEC.md` (reverse-engineered from commit `577956c`, the reality).

**Purpose:** understand what you actually want to build, name the gap precisely, protect what already works, and produce one prompt you paste into Claude Code to turn what exists into the real product.

---

# PART 1 — What the product actually is

Strip the 70 sections down and the vision is one sentence:

> **A control plane that always answers four questions — what is happening, why, does someone need to act, what happens next — across the whole path from business request to verified production delivery.**

Everything else in the master prompt is a consequence of that sentence:

| The vision says | Because |
|---|---|
| Attention Center is the primary screen | If you must hunt for problems, the control plane failed |
| Blockers, Decisions, Dependencies are first-class **objects**, not statuses | A status can't tell you *why*, *who owns it*, or *what unblocks it* |
| Every work item opens one 360° record | The answer must live in one place, not across six systems |
| Completion is evidence-driven | "Someone dragged the card to Done" is not delivery |
| Config is hierarchical and versioned, with impact preview | A control plane whose own rules change silently isn't in control |
| AI output → schema → validation → policy → domain command | AI is an *executor*, never the source of truth |
| Provenance on every value | "Where did this number come from?" must always be answerable |

**The critical framing point:** in the vision, the SDD pipeline (Constitution → SPEC → Clarify → Plan → Tasks → Analyze → Implement) is **one subsystem hanging off a work item** — sections 17–24 out of 70. It is the *engine room*, not the product.

**What was built is the engine room, and nothing else.**

That is the whole gap in one line. It is also good news: the hard, easy-to-get-wrong part (gated, audited, transactionally-consistent AI orchestration) is real and working. What's missing is the delivery model *around* it — which is additive, not a rewrite.

---

# PART 2 — The gap

## 2.1 The headline

| | Vision | Built |
|---|---|---|
| Product category | Software delivery control plane | Documentation-pipeline governance tool |
| Primary screen | Attention Center ("what needs me?") | Project list |
| Domain model | Org → Client → Project → WorkItem(+children) → Repo, with Dependencies, Blockers, Decisions, Evidence, AgentRuns | Project → WorkItem → Pipeline → Stage → Approval (6 models) |
| Work item | type, risk, priority, owner, executor, due date, progress, dependencies, blocker, decision, aiCost, provenance | title, description, status string that is **never rendered** |
| End of the flow | Merged PR, passing tests, verified deployment, evidence complete | A Markdown document titled "Deploy" |
| Tenancy | Organization → Client hierarchy, per-client config & credentials | Single-tenant, one shared `.env` |
| Access control | 7 roles, real backend authorization | **None** — every route callable by anyone |
| Routes | ~9 main areas + Quick View + 360° record + Ctrl+K | 3 routes, 2 nav links |

## 2.2 Gap register

Legend: **KEEP** = built and correct · **EXTEND** = built but too thin · **MISSING** = not present · **CONFLICT** = the two documents disagree and you must choose.

### Domain & work model

| # | Vision ref | Item | State | Detail |
|---|---|---|---|---|
| 1 | §4 | Work item type (project/task/bug/change) | MISSING | No type field; everything is an undifferentiated "work item" |
| 2 | §4 | risk, priority, owner, executorType, dueDate, progress | MISSING | None of the six exist |
| 3 | §4 | 9-state `WorkStatus` incl. `decision_required`, `blocked`, `review` | MISSING | `WorkItem.status` is a free string copied from Jira and **never displayed** (spec §6) |
| 4 | §4 | `parentId` — decomposition into child work items | MISSING | Flat list only |
| 5 | §35 | Organization → **Client** → Project hierarchy | MISSING | No Client entity; `Project.key` is *globally* unique (spec §25) |
| 6 | §11 | Dependencies between work items | MISSING | No relationship exists in the schema (spec §15) |
| 7 | §12 | Critical path | MISSING | Depends on #6 |
| 8 | §7 | Blocker as a first-class object (reason, owner, requiredAction, blockedSince, impact) | MISSING | Only `PipelineStatus.BLOCKED`, self-referential: a pipeline blocks *itself* on rejection (spec §15) |
| 9 | §8 | Decision object (question, reason, impact, aiRecommendation, aiConfidence, deadline, approver) | EXTEND | `Approval` records the *outcome* (decision, name, comment) but never the *context*. The UX rule "context before action" is not met |

### Attention & UX

| # | Vision ref | Item | State | Detail |
|---|---|---|---|---|
| 10 | §6 | Attention Center | MISSING | Spec §22: no notification, no count, not even "N approvals pending" on the home page — **for a product whose core value is gated approval** |
| 11 | §5 | Dashboard as command center | MISSING | Home page is a project list with forms |
| 12 | §41 | Quick View drawer | MISSING | Full-page navigation only |
| 13 | §42 | Progressive disclosure (3 levels) | MISSING | One level |
| 14 | §9 | 360° Delivery Record (9 tabs) | EXTEND | `/pipelines/[id]` covers roughly one tab (SDD). Overview, Dependencies, Execution, Code, Tests, Evidence, Timeline, Configuration all absent |
| 15 | §34 | Per-work-item timeline | EXTEND | `AuditEvent` **has the data** but is only rendered as one global feed capped at 200 rows, no filters, no pagination |
| 16 | §39 | Ctrl+K command palette / global search | MISSING | No search or filter anywhere (spec §23) |
| 17 | §46 | UI states (loading/empty/error/partial/stale/permission-denied…) | EXTEND | Disabled-button "…ing" text + inline red error is the whole system |
| 18 | §57 | Explainability — "why?" on every status, risk, recommendation | MISSING | Nothing explains anything |
| 19 | §45,§48 | Responsive + WCAG 2.2 AA | MISSING | Not addressed |

### SDD engine

| # | Vision ref | Item | State | Detail |
|---|---|---|---|---|
| 20 | §20 | **Clarify** — AI stops, asks a human, waits, records the answer against the artifact version | MISSING | The master prompt calls this "extremely important". Closest equivalent is reject → redraft, which **re-runs the identical fixed prompt** and does not inject the rejection comment (spec §13) |
| 21 | §23 | **Analyze** — consistency check across Constitution/SPEC/Plan/Tasks with severity levels | MISSING | Not in the stage list |
| 22 | §18 | Constitution as a **project-level versioned artifact** | CONFLICT | Built as a per-work-item stage, so every work item redrafts its own constitution. Wrong scope and wasteful |
| 23 | §17 | Final stage = **Implement** (real code) | CONFLICT | Built final stage = `DEPLOY`, a Markdown *description* of deployment. The flow ends at documentation |
| 24 | §24 | Configurable gate policy (SPEC→PM, Plan→Tech Lead, Implement→auto) | EXTEND | Gates are hardcoded-always-on; `requiresApproval` in `workflow.yaml` **is read by nothing** (spec §25) |
| 25 | §62 | Versioned artifacts, pause/resume SDD run state machine | EXTEND | Stage content is overwritten in place; no artifact versions. Drafting is synchronous inside one HTTP request — no persisted "running" state (spec §26: `AI_DRAFTING` is a dead enum value) |
| 26 | §17 | Pipeline is optional per work item | CONFLICT | `Pipeline.workItemId` is unique and a pipeline is auto-created for *every* work item. A tracked bug that needs no SDD run still gets a 5-stage pipeline |

### AI execution

| # | Vision ref | Item | State | Detail |
|---|---|---|---|---|
| 27 | §25 | Agent registry + configurable routing (React→Frontend Agent, Security→Human) | MISSING | One global executor chosen by `ANTHROPIC_API_KEY` presence |
| 28 | §26 | `AgentRun` entity (status, tool calls, retries, input/output refs, error) | MISSING | Cost/tokens are stored on `Stage`; there is no run record |
| 29 | §27,§58 | AI output → structured schema → validation → policy → domain command | MISSING | AI returns free Markdown, stored verbatim as authoritative content. This is the one rule the master prompt states twice |
| 30 | §28 | Sandboxed coding runtime, least privilege, repo scoping | MISSING | No code execution at all |
| 31 | §56 | AI cost rollups, budgets, thresholds, hard stop | EXTEND | Per-draft cost **is** captured from real usage (good) but never summed per work item/project/client, no budget, no threshold |
| 32 | §13 | Retry/backoff | MISSING | A Claude failure throws and leaves the pipeline untouched (spec §11) |

### Integrations, config, evidence, platform

| # | Vision ref | Item | State | Detail |
|---|---|---|---|---|
| 33 | §15 | Connector model (mode, authType, syncMode, capabilities, status, lastSyncAt) | EXTEND | `IntegrationAdapter` interface exists (good seam) but no `Connector`/`SyncRun` entities |
| 34 | §16 | Conflict handling (manual wins + surface for review) | MISSING | Sync upserts blindly; a hand-edited value would be silently overwritten |
| 35 | §14 | **Field-level** provenance | EXTEND | Row-level `source`/`externalId` on WorkItem only |
| 36 | §15 | Azure DevOps | MISSING | Enum value exists, silently aliased to the manual adapter, not offered in the UI (spec §11) |
| 37 | §29–32 | Repositories, git, PRs, commits, tests | MISSING | The product has zero awareness of code (spec §17) |
| 38 | §33 | Evidence-driven completion | MISSING | "Done" = final stage approved. No `Evidence` entity, no attachments, no CI/test linkage |
| 39 | §35–38 | Hierarchical config, effective value, override, reset, **impact preview**, versioning | MISSING | One global YAML. Worse: stage order resolves dynamically per transition, so **editing the file changes pipelines already mid-flight** (spec §21) |
| 40 | §54 | Roles & real backend authorization | MISSING | No user, no session, no guard. Approver is a typed-in free-text name |
| 41 | §55 | Per-client credential isolation, secrets handling | MISSING | One shared `.env` for everything |
| 42 | §49 | Workflow engine + workers + durable long-running processes | MISSING | Everything runs synchronously in the request |
| 43 | §59 | REST read API, OpenAPI | MISSING | Mutation routes only; reads happen inside Server Components (spec §7) |
| 44 | §66 | Definition of Done: tests, validation, authz, states, audit | MISSING | No test framework, no test files, no CI (spec §18) |
| 45 | §52 | Idempotency | KEEP (partial) | Work-item upsert on `(projectId, source, externalId)` is genuinely idempotent. No webhooks yet, so untested elsewhere |

## 2.3 The five known self-inconsistencies (cheap wins, fix while you're in there)

Straight from spec §30 — these are bugs, not design choices:

1. `requiresApproval` in `workflow.yaml` is declared and ignored by all code.
2. `StageStatus.AI_DRAFTING` and `APPROVED` are never assigned by any code path.
3. `WorkItem.status` is synced and stored but never rendered.
4. `Project.integrationConfig` supports per-project Jira credentials; no UI ever sets it.
5. `AZURE_DEVOPS` is a first-class enum, silently behaves as manual, and is not offered in the form.

---

# PART 3 — What must NOT be thrown away

This is the part most "fix my app" prompts get wrong. The existing codebase has several things that are genuinely well built and that the vision *requires anyway*. The prompt in Part 5 protects them explicitly.

| Asset | Why it's worth protecting |
|---|---|
| **`recordAuditEvent()` — single write path, called inside the same transaction as the state change** | This is master-prompt §53 already satisfied, and done better than most production systems. Audit can never drift from state. Do not let anyone add a second write path. |
| **`AgentExecutor` interface + mock/Claude implementations** | Exactly the seam §27 and §63 need. The Agent Registry is built *behind* this interface, not instead of it. The mock executor also means the product is demoable and testable with zero API spend. |
| **`IntegrationAdapter` interface + Jira adapter** | The connector framework in §15/§61 is built by widening this, not replacing it. ADF→plain-text conversion and the upsert-safe identity key are real work already done. |
| **Config-driven pipeline shape (`workflow.yaml` + `prompts/*.md`)** | §35 wants config-driven behavior. The mechanism is right; the *scope* (global) is what changes. |
| **Real usage-based token/cost capture** | §56's foundation. Rollups and budgets sit on top of data that's already correct. |
| **Stage/Pipeline state machines + reject→redraft loop** | §24's gate mechanic, working, with accumulating decision history. |
| **Prisma 7 + `adapter-pg` + Neon, one clean migration, idempotent seed** | §50 satisfied. Do not restart the migration history. |
| **Next.js 16 / React / TS / Tailwind v4 / Postgres** | Already the exact stack §59 asks for. **No stack change is needed.** |
| **OpenSpec dev workflow (`openspec/`, `.claude/`)** | Keep for developing the repo. Never confuse it with the product's own SDD feature (spec §14) — the prompt says so explicitly. |

---

# PART 4 — Decisions made for you

The two documents conflict in places. Rather than let Claude Code re-litigate them mid-build, the prompt below states the resolution. Reasoning, so you can overrule:

**1. Evolve the existing app; do not split into services yet.**
The stack already matches §59. The two real deficiencies — no domain layer, and long AI calls running synchronously inside an HTTP request — are both fixable *inside* the Next.js app: a `src/domain/` service layer plus a database-backed job queue. Introducing Temporal or a separate backend now would burn weeks before a single new user-visible capability ships. The prompt instead mandates **hard domain boundaries** (no Prisma outside `src/domain/`), which is what makes a future split cheap. §49's shape is honored logically; its deployment topology is deferred.

**2. Tenancy and identity go first, as a small slice — not the delivery model.**
Normally you'd build the visible thing first. Not here: there are 6 models and roughly a dozen query sites today. Adding `Client` and a tenant filter now is a day's work; after slices 1–3 it touches every call site in the system, and spec §30 flags this as the highest-cost debt. It is also a hard prerequisite for §41's per-client credentials. So: Slice 0 is deliberately small and boring, then the product gets its identity in Slice 1.

**3. Constitution is promoted out of the pipeline.**
It becomes a versioned, project-scoped artifact (§18). A pipeline *references* the constitution version it ran against instead of regenerating it per work item.

**4. The stage list becomes configurable, and the default gains Clarify + Analyze.**
Default: `SPEC → Clarify → Plan → Tasks → Analyze → Implement`. `Deploy` survives as an optional final stage for teams that want a release-notes gate. Crucially, **stage order is snapshotted onto the pipeline at creation** so a config edit can never rewrite a run in flight (fixes spec §21's hazard).

**5. Pipelines become optional and explicitly started.**
A work item exists on its own. "Start SDD" is an action. This unblocks the whole §4 work model — you can track a bug or a change without forcing it through five documentation gates.

**6. Reject must carry feedback into the redraft.**
Today redraft re-runs the identical prompt, so rejection is a no-op on output. The rejection comment becomes part of the redraft context. This is the smallest change in the list and probably the highest daily value.

---

# PART 5 — The prompt for Claude Code

Everything below the line is the deliverable. Paste it into Claude Code at the repo root. Attach both source documents (`Claude Code Master Prompt — AI Delivery Control Center.md` and `PRODUCT_SPEC.md`) alongside it.

---

````markdown
# Evolve Delivery Control Center into the real product

You are working in an existing repository. Two documents are attached:

- **`Claude Code Master Prompt — AI Delivery Control Center.md`** — the target product. Treat as the specification of intent.
- **`PRODUCT_SPEC.md`** — an accurate reverse-engineering of what this repo does today (commit `577956c`). Treat as a factual baseline, not as a goal.

**Your job is to close the distance between them without destroying what already works.**

Start by reading the repository yourself and confirming `PRODUCT_SPEC.md` still matches reality. If it has drifted, say so before changing anything.

---

## 0. The one-sentence product

A control plane that always answers four questions — **what is happening, why, does anyone need to act, what happens next** — across the path from business request to verified delivery.

When you face a design choice, do not ask "how would a task manager do this?" Ask **"how should a delivery control plane do this?"**

What exists today is the *engine room* of that product: a gated, audited, AI-drafted documentation pipeline. It is good and it stays. What is missing is the entire delivery model around it — work model, attention, blockers, decisions, dependencies, evidence.

---

## 1. Protect these — they are already correct

Do not rewrite, replace, or route around any of the following. Extend them.

1. **`recordAuditEvent()` in `src/lib/audit.ts`** is the *single* write path for `AuditEvent`, and it is called inside the same transaction as the state change it describes. This property is non-negotiable. Every new state change you introduce records its audit event in the same transaction. Never add a second write path. Never write an `AuditEvent` outside a transaction.
2. **The `AgentExecutor` interface** (`src/lib/agents/`) and both implementations. The mock executor must keep working with no API key — it is how the product is demoed and tested. All new AI capability is built *behind* this interface.
3. **The `IntegrationAdapter` interface** (`src/lib/integrations/`) and the Jira adapter, including its ADF→text conversion and the `(projectId, source, externalId)` identity key. The connector framework widens this interface; it does not replace it.
4. **Config-driven behavior** via `config/workflow.yaml` + `config/prompts/*.md`. The mechanism is right. Only its *scope* changes (global → hierarchical).
5. **Real usage-based token/cost capture.** Keep the numbers coming from the API's actual `usage`, never estimated, in the Claude path.
6. **Prisma migration history.** Add migrations. Never reset, squash, or recreate `20260814065231_init`.
7. **The stack**: Next.js 16 App Router, React, TypeScript, Tailwind v4, Postgres, Prisma 7 + `@prisma/adapter-pg`. This already matches the target architecture. **Do not change the stack.** Do not add a UI component library unless you first propose it and I approve.
8. **The OpenSpec workflow** in `openspec/` and `.claude/`. That governs how *this repo* is developed. It is not a product feature and must never be conflated with the product's own SDD pipeline. Follow it for your own changes.

---

## 2. Architecture rules

**Evolve the existing Next.js application. Do not split into separate services, and do not introduce Temporal.**

But fix the two structural problems:

**2.1 Introduce a domain layer.** Create `src/domain/<aggregate>/` modules (work-item, pipeline, blocker, decision, dependency, evidence, config, agent, connector).

- All business rules and all Prisma access live here.
- **No Prisma import in any React component, page, or API route** after the slice that touches it. Server Components call domain query functions; API routes are thin controllers that validate input, call a domain command, and map errors to status codes.
- Every domain command: validate input with **Zod** → check authorization → execute inside a transaction → record the audit event in that same transaction → return a typed result.
- This boundary is what makes a future backend split cheap. Enforce it.

**2.2 Make long-running work asynchronous and durable.** AI drafting currently blocks an HTTP request and leaves nothing behind on failure. Replace with a persisted job model:

- A `Job` table (type, payload, status, attempts, lastError, scheduledAt, lockedAt, idempotencyKey) and a worker loop.
- Start with a Postgres-backed queue polled by a Next.js route handler or a small `worker.ts` process — deliberately simple. Do not add Redis/BullMQ until there is a measured need.
- Jobs are **idempotent** and **retried with exponential backoff** (Claude and Jira calls both need this — today neither retries).
- The UI shows real in-flight state. This is what finally makes `StageStatus.AI_DRAFTING` a live value rather than a dead enum.

**2.3 AI never writes authoritative state directly.** Enforce the master prompt's §58 pipeline:

```
AI output → Zod schema → validation → policy check → domain command → state change
```

Stage *content* may remain Markdown (that's the artifact). But anything the AI proposes that changes domain state — a risk assessment, a suggested dependency, a clarification question, an analysis finding, a recommended executor — must be returned as **structured JSON validated against a schema**, and applied only via a domain command. Never `JSON.parse` a model response without schema validation.

---

## 3. Conflicts between the two documents — resolved. Do not re-litigate.

1. **Constitution** is promoted out of the per-work-item pipeline into a **project-scoped, versioned artifact**. A pipeline records which constitution version it ran against.
2. **Stage list becomes configurable**; the default becomes `SPEC → Clarify → Plan → Tasks → Analyze → Implement`, with `Deploy` available as an optional final release gate. `Clarify` and `Analyze` are new and required by the vision (§20, §23).
3. **Stage order is snapshotted onto the `Pipeline` at creation.** Editing `workflow.yaml` must never alter a run already in flight. This is an active bug today (`PRODUCT_SPEC.md` §21).
4. **A pipeline is optional and explicitly started.** Work items exist independently; "Start SDD" is a user action. Existing 1:1 auto-creation is removed (migrate existing rows, don't drop them).
5. **Rejection feedback must reach the redraft.** Today redraft re-runs the identical prompt, making rejection comments inert. Pass the rejection comment (and clarification answers) into the redraft context.
6. **`requiresApproval` must actually work**, and gate policy becomes role-based (e.g. SPEC→Project Manager, Plan→Tech Lead, Implement→automatic once prior gates pass). AI may never bypass a required gate.

---

## 4. Fix these five known inconsistencies as you pass through

From `PRODUCT_SPEC.md` §30 — these are defects, not features:

1. `requiresApproval` is declared in config and read by nothing.
2. `StageStatus.AI_DRAFTING` and `APPROVED` are never assigned.
3. `WorkItem.status` is synced and stored but never rendered.
4. `Project.integrationConfig` supports per-project credentials with no UI to set them.
5. `AZURE_DEVOPS` is a first-class enum that silently behaves as the manual adapter and isn't offered in the UI. Either implement it or mark it explicitly unavailable — no silent aliasing.

---

## 5. Build order — vertical slices

Do not build everything at once. Do not build isolated mock screens. **Each slice ends with a working end-to-end path against the real database, with tests.**

Before writing code for a slice, produce a short implementation plan mapped to actual files in this repo, and wait for my approval.

### Slice 0 — Tenancy, identity, and the cheap fixes (small, do it first)

Boring on purpose. It costs a day now and a month later.

- `Organization` and `Client` entities; `Project` scoped to a `Client`. `Project.key` becomes unique **per client**, not globally.
- Real `User`, session-based authentication, and roles: Admin, Manager, Project Manager, Tech Lead, Executor, Viewer, Security Reviewer.
- **Backend authorization on every route and every domain command.** Hiding a button is not authorization.
- `Approval.approverName` free text is replaced by a real user reference. Same for `AuditEvent.actorName` on `USER` events.
- Tenant scoping applied to every query, with a helper that makes an unscoped query the hard path.
- Per-client integration credentials and per-client AI configuration, replacing the single shared `.env` (secrets stay out of the database in plaintext).
- Fix the five inconsistencies in §4 above.
- Introduce the test framework (**Vitest** for unit/domain, **Playwright** for one end-to-end smoke) and CI. Every subsequent slice ships with tests.

**Done when:** two clients coexist with fully isolated data and credentials, an unauthenticated request to any route is rejected, and a Viewer cannot approve a stage — proven by tests.

### Slice 1 — The delivery model and the Attention Center (this is the product's identity)

- Extend `WorkItem` to the master prompt's §4 shape: `type` (project/task/bug/change), `parentId`, `status` (the 9-state `WorkStatus`), `risk`, `priority`, `ownerId`, `executorType`/`executorId`, `dueDate`, `progress`, `sourceMode`, `aiCost`.
- **`Dependency`** as a first-class entity between work items, with a stated reason. Cycle detection required.
- **`Blocker`** as a first-class entity: reason, blockingItemId, ownerId, requiredAction, blockedSince, impact, resolvedAt.
- **`Decision`** as a first-class entity: question, reason, impact, aiRecommendation, aiConfidence, deadline, approverId, status. Existing `Approval` records become the decision *outcome* on stage gates — reuse, don't duplicate.
- **Attention Center** (`/attention`): every item needing a human, grouped — Decisions, Blockers, Risks, Deadlines, Clarifications, Approval Gates, Sync Problems. **Every row states why it is there.** Never render "Blocked" without the reason, the owner, and the required action.
- **Dashboard** becomes a command center with clickable attention cards, not a project list.
- **Quick View**: a side drawer on any work item — blocker panel or decision panel first, everything else after.
- **360° Delivery Record** with tabs; in this slice implement Overview, Dependencies, and Timeline (per-item, from the existing `AuditEvent` data). Stub the rest with honest empty states, not fake data.
- **Dependency Map** and a status board. Selecting a node highlights upstream, downstream, and the blocker chain, and dims the rest. The graph must be explanatory, not decorative — a user must be able to read *why* B depends on A.
- Fix the audit trail: filters (project, actor, date, action) and pagination. The 200-row silent truncation is a defect in the product's core transparency promise.

**End-to-end scenario that must work against the real database:**
`Create client → create project → create work item → add dependency → create blocker → it appears in the Attention Center with a full explanation → open Quick View → resolve the blocker → timeline and audit both reflect it`

### Slice 2 — SDD as a subsystem

- Constitution as a project-level versioned artifact.
- **Clarify**: when information required for implementation is missing, the run **stops**, creates a clarification question, surfaces it in the Attention Center, waits for a human answer, stores the answer against the artifact version, then resumes. AI must not silently guess. This is explicitly called out as extremely important in the vision.
- **Analyze**: consistency check across Constitution/SPEC/Plan/Tasks producing findings with severity (Info/Warning/Medium/High/Critical). Critical findings block implementation.
- Versioned artifacts — stage content is no longer overwritten in place.
- SDD run state machine that genuinely pauses and resumes across process restarts (built on the Slice 0 job model).
- Role-based, config-driven gate policy.
- Rejection and clarification feedback flow into redrafts.

### Slice 3 — Agents as real execution resources

- `Agent` registry and configurable routing (e.g. React→Frontend Agent, Dataverse→Data Agent, Security→Human).
- **`AgentRun`** entity per the master prompt §26: runtime, model, status, input/output references, tool calls, token usage, cost, retryCount, error. Migrate the per-stage cost fields into it without losing history.
- Retry with backoff, per-run limits, structured errors.
- AI cost rollups per work item / project / client, warning thresholds, budgets, and a hard stop or approval requirement when a budget is exceeded.
- Restricted, permissioned visibility of raw run detail.

### Slice 4 — Connector framework

- `Connector` and `SyncRun` entities (mode, authType, syncMode, capabilities, status, lastSyncAt).
- **Field-level provenance** — for each value: source, externalId, actor, timestamp. The UI must answer "where did this value come from?" on any field.
- **Conflict handling**: default to *manual value wins and the conflict is surfaced for review*. An external sync must never silently overwrite a human edit.
- Azure DevOps adapter. GitHub adapter.
- Webhook intake, idempotent — duplicate delivery must not duplicate anything.
- No connector-specific logic inside the core domain.

### Slice 5 — Engineering evidence

- Repository, branch, commit, pull request, test run, build, deployment entities.
- Code & Changes and Tests tabs on the 360° record — trace **work item → code change**.
- **`Evidence`** entity and **evidence-driven completion**: a work item completes only when all mandatory evidence is present, or an exception is explicitly approved and recorded. Status alone must never mean "done".

### Slice 6 — Configuration Center

- Hierarchical config: Organization → Client → Project → Repository → Work Item, with inheritance and overrides.
- Each field shows effective value, source scope, inherited-or-override, help text, and reset-to-inherited.
- **Impact preview before saving** — "this affects 5 clients, 12 projects, 94 work items" — then explicit confirmation. No silent config changes.
- Config versioning and audit. Running processes reference the version they started under.

---

## 6. Definition of Done (every feature, every slice)

A feature is not done because the UI renders. It is done when it has:

- persistent backend state with a migration
- Zod input validation
- backend authorization (not just a hidden button)
- loading, empty, error, and permission-denied states
- an audit event, written in the same transaction as the state change
- tests (domain unit tests always; a Playwright path for user-facing flows)
- a responsive layout, keyboard navigation, visible focus, and labels — target WCAG 2.2 AA
- **no silent failure** and no placeholder-only interaction

Additionally, on every screen:

- **Explain every important status.** Risk, blocked, at-risk, recommended executor, AI recommendation, cost — each must carry a textual rationale. Never show an unexplained score.
- **Context before action.** Never render Approve/Reject before the user can see what is being decided, why, the consequence, the recommendation, and the deadline.
- **Automatic first, manual always available.** Anything imported must remain manually creatable, editable, and overridable — with provenance preserved.

---

## 7. UI direction

Modern enterprise SaaS: clean, calm, information-dense without clutter, strong hierarchy, generous whitespace, consistent spacing and status language. Semantic colors — green healthy, blue active, purple ready/AI, amber decision/warning, red blocked/critical, gray inactive — **never color alone**; always pair with a label or icon.

Avoid: gradient-heavy pages, gimmicky AI visuals, excessive animation, developer-centric density on management screens.

Three levels of disclosure: Dashboard/Attention → Quick View → 360° Record. Do not put full technical complexity on the first screen.

---

## 8. What this product is not

Not a Jira clone. Not a Kanban board. Not an AI chatbot. Not a GitHub dashboard. Not a set of disconnected admin screens. It is **orchestration and delivery control**.

---

## 9. How to work

1. Read the repository and verify `PRODUCT_SPEC.md` against it. Report any drift.
2. Produce a concrete plan for **Slice 0 only**, mapped to real files and real migrations, with the tests you intend to write. Wait for my approval.
3. Implement the slice end to end. Build, lint, run the tests, and verify against a live database before telling me it's done.
4. Follow the repo's OpenSpec workflow for your own changes.
5. Never mark something complete when tests fail or the implementation is partial. Say what's incomplete and why.
6. Ask before anything destructive: dropping columns, resetting migrations, deleting data, changing the stack.

Begin with step 1.
````

---

# PART 6 — How to use this

1. Paste the block in Part 5 into Claude Code at the repo root, with both source documents attached.
2. Expect it to come back with a drift report and a Slice 0 plan. Read the plan against Part 4 of this document — if it proposes splitting services, adding Temporal, swapping the stack, or building screens before the domain layer, push back and point at §2 of the prompt.
3. Run one slice at a time. The prompt is deliberately written so each slice can be handed over in a fresh session by re-pasting it and naming the slice.
4. When a slice lands, regenerate `PRODUCT_SPEC.md` the same way it was produced the first time. That document is your ground truth, and keeping it honest is what keeps the next prompt honest.

**The single highest-value change in this whole document**, if you only do one thing: make rejection feedback reach the redraft (Part 4, decision 6). It's an afternoon, and right now every rejection you record produces an identical regeneration.
