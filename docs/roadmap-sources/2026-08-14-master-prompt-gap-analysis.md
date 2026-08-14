> **Provenance note (added by the agent when saving this file — not part of the
> original document):** Pasted into chat by the user on 2026-08-14, in a
> single message, explicitly identified as "the original authoritative
> Master Prompt / gap-analysis source." This is the first verbatim capture
> of this document in the repository — an earlier version of it was
> discussed in an earlier session but never saved, which is the reason
> `docs/roadmap-sources/` and `docs/ROADMAP.md` exist. Content below this
> line is verbatim as received, unedited.

---

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
