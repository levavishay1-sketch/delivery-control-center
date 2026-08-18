# Core Product Definition — Gap Analysis & Reconciliation

Source: `docs/roadmap-sources/2026-08-17-core-product-definition.md` (86 numbered sections,
received verbatim 2026-08-17), compared against the codebase at commit through archived Slice 13,
and against the existing Slices 14-21 stubs scoped under
`docs/roadmap-sources/2026-08-16-product-vision-blueprint.md`.

This is **analysis only** — no OpenSpec change, no code, no schema edits. Every "Current State"
cell below is a verified fact (file:line), not a guess. Per the source document's own instruction
("do not silently invent a product decision... surface material ambiguities"), Part 2 originally
listed the open questions blocking any new slice in these areas — **all nine were resolved by the
user on 2026-08-17** (recorded verbatim/paraphrased below, in the same Q1-Q9 numbering). Still no
new Slices, OpenSpec change, code, or schema edits follow from this update — that's explicitly
deferred to a later turn.

Status legend: **Aligned** (already matches or closely matches the new spec) · **Partial** (a real
piece exists but doesn't cover the requirement) · **Missing** (nothing exists) · **Conflicts**
(current model actively contradicts the new spec's shape, not just incomplete).

---

## Part 1 — Capability inventory

### §1-2 Product Purpose & Core Experience

| Concept | Current State | Status |
|---|---|---|
| One control plane answering "what/why/state/blocked/next" | Dashboard (`src/app/page.tsx`) + Attention Center (`src/app/attention/page.tsx`) + 360° Record (`src/app/work-items/[id]/360/page.tsx`) together cover most of §2's question list already, for Project/WorkItem-scoped work | Partial — real for Projects/WorkItems; nothing yet at the Requirement or Customer-wide scope §79-80 describe |
| AI-driven delivery across customer systems, repos, requirements, SDD, agents, humans, source control, tests, decisions, changes | Every piece except "requirements" exists as a real domain concept today (Client≈Customer, Repository, SDD pipeline, Agent, WorkItem, source control evidence, TestRun, Decision) | Partial — Requirement is the one entirely new pillar (see §14 below) |

### §3-7 Customer, Connections, Sources, Repositories, Provider Independence

| Concept | Current State | Status |
|---|---|---|
| Customer as top-level isolation boundary containing Users/Roles/Permissions/Connections/Sources/Repositories/Projects/Requirements/Policies/AI Config/System Context/WorkItems/Decisions/Audit | Today's top-level tenant boundary is `Client` (`prisma/schema.prisma:335`), itself under `Organization` (`schema.prisma:320`). `Client` already contains: memberships/roles (`ClientMembership`, `schema.prisma:308`), `Repository[]` (Slice 12), `Connector[]` (Slice 13), `Project[]`, `aiBudgetUsd`/`aiConfig`/`integrationConfig` (Json — unused today) | **Aligned** — resolved (Part 2, Decision 1): "Customer" was a naming mistake; the existing `Organization → Client` model stays exactly as-is, no new entity |
| Connection (technical connectivity) distinct from Source (repo/DB/CRM/API/pipeline/etc.), one Connection → many Sources | `Connector` (`schema.prisma:761`) conflates both: it is simultaneously the auth/connectivity object AND assumed to correspond to exactly one external system instance. `Repository.connectorId` is `@unique` (`schema.prisma:870`) — strictly 1:1, not "one Connection exposes multiple Sources" | Conflicts — confirmed gap; direction resolved (Part 2, Decision 2): introduce `Connection` as a flexible, extensible concept (CLI/MCP/Connectors/GitHub/APIs/etc.), one Connection → many Sources, taxonomy deliberately not locked down yet |
| Source types beyond Repository (DB, CRM, API, Pipeline, Design, Docs, Business System) | `IntegrationType` enum (`schema.prisma:13`) has 9 values (`MANUAL/JIRA/AZURE_DEVOPS/GITHUB` + Slice 13's `CRM/TEAMS/MCP/CUSTOM_API/OTHER`), but every value still names a *work-tracker or connector type*, not a generic Source taxonomy (Database/API/Pipeline/Design Source have no representation at all) | Missing — per Decision 2, do not pre-lock this taxonomy when it's eventually scoped; keep it open/extensible rather than another closed enum |
| Repository belongs to Customer, may be in multiple Projects/Initiatives/Requirements | `Repository.clientId` (Slice 12, `schema.prisma:876`) + `ProjectRepository` join (`schema.prisma:897`) already implement exactly this at the Project level | Aligned |
| Source-control provider independence (normalized Branch/File Change/Commit/Push/Code Change Request/Review/Comment/Check/Conflict/Merge) | `Commit`/`PullRequest`/`TestRun`/`Build`/`Deployment` (`schema.prisma:908-993`) are already GitHub-shaped but provider-agnostic in naming; Azure DevOps and GitHub adapters both exist (Slice 4) for work-item sync, but evidence/PR tracking (Slice 5) is GitHub-only today — no `Branch` or `Review Comment` entity exists | Partial |

### §8-13 Repository Onboarding, Discovery, Context, System Context, Reconciliation

| Concept | Current State | Status |
|---|---|---|
| Repository Discovery (targeted, persistent understanding: purpose/stack/structure/modules/domains/APIs/data stores/testing/conventions/unknowns/evidence) | Zero matches for `RepositoryDiscovery` anywhere in code | Missing |
| Repository Context (persistent, navigational, not a substitute for source verification) | Zero matches for `RepositoryContext` anywhere in code | Missing |
| Context maintenance on source change (detect → assess impact → targeted re-analysis → retain verified revision) | No source-revision-aware context object exists to maintain | Missing |
| System Context (cross-repo/cross-system relationships) | Zero matches for `SystemContext`; `ProjectRepository` only records which repos a project linked, not relationships *among* them | Missing |
| System Reconciliation (incorporate newly discovered cross-source relationships) | No such mechanism exists | Missing |

This entire cluster maps onto the old blueprint's Slice 14 (`repository-sdd-bootstrap`, still
"Scoped, not started"), whose own scope was a single paragraph (§5.3 of the 2026-08-16 blueprint).
The new spec's §8-13 is far more detailed and introduces System Context (§12-13) as a wholly
separate concept the old blueprint never named. **Slice 14 as currently scoped is too thin to
cover this — it needs re-scoping against §8-13, not a straight go-ahead.**

### §14-27 Requirement Lifecycle

| Concept | Current State | Status |
|---|---|---|
| Requirement as an entity distinct from Project/WorkItem | Zero matches for `Requirement` anywhere in code (schema, domain, app) | Missing — shape resolved (Part 2, Decision 3): a flexible intake item that may represent a Project/Task/Bug/Change/other type, from manual entry or an external source, standalone or optionally linked to an existing `Project` — never required to belong to one |
| AI processing optional at Requirement creation (human chooses when to spend AI cost) | The closest existing analog is `Pipeline`'s optional/explicit start (Slice 2) — a `WorkItem` can exist with no pipeline running. No equivalent gate exists above the WorkItem/Project level because there's no Requirement yet | Missing (pattern exists one level down, not here) |
| Requirement Triage (type/size/complexity/domains/risk/scope/relevant sources/unknowns) | No triage step exists for anything above WorkItem today | Missing |
| Impact Discovery (which Repositories/APIs/DBs/CRM/Integrations are affected, dynamic scope) | No equivalent — closest is Slice 15's stub (`repository-relevance-recommendation`), also not started | Missing |
| Deep Requirement Analysis (Current State / Desired State / Change Gap, business rules, contradictions, missing decisions) | No equivalent exists at any level | Missing |
| AI Questions (question/why/context/evidence/options/recommendation/blocking status/decision owner) | `ClarifyQuestion` (`schema.prisma:604`) has `question`/`answer` only — no `evidence`, `possibleOptions`, `blocking` flag, or explicit decision-owner field, and it's scoped only to the SDD pipeline's `CLARIFY` stage, not to any AI-execution moment | Partial |
| Pause and Resume (persist state, wait, resume without losing work) | `Stage.status = AWAITING_CLARIFICATION` + unanswered `ClarifyQuestion` rows already implement exactly this pattern durably (Slice 2) — but only for the one pipeline stage, not generalized to any AI execution point | Partial (real pattern, narrow scope) |
| Question / Approval / Review as three separate concepts | Today: `Decision` (question + single approver + AI recommendation, `schema.prisma:499`), `Approval` (Stage-scoped only, `schema.prisma:1023`), `ClarifyQuestion` (CLARIFY-stage only). No general-purpose "Review" concept exists anywhere | Conflicts — direction resolved (Part 2, Decision 4): extend the existing three models in place with the missing fields, kept flexible for later change, rather than a full rename/merge now |
| Owner vs. Decision Owner (not necessarily the same person) | `WorkItem.ownerId` (`schema.prisma:440`) is the only standing owner field; `Decision.approverId` (`schema.prisma:509`) is per-decision, not a standing WorkItem property | Missing (as a WorkItem-level pair) |
| Responsibility transfer (ownership + decision ownership, traceable) | `executorId`/`ownerId` are mutable and captured in `AuditEvent` (`work-item/commands.ts`) as part of general update audit entries — but "Decision Owner Transfer" is not its own tracked event type | Partial |
| Discovery Gate ("Ready for SDD" recommendation, human decides) | `SDD activation` doesn't exist above WorkItem yet; closest analog is `Pipeline`'s optional explicit start | Missing |
| SDD Activation choices (Start / Continue Without SDD / Postpone / Return to Discovery) | `Pipeline` today is binary — started or not — no "continue without SDD" tracked state, no "postpone," no "return to discovery" | Partial |

This entire cluster (§14-27) is **the single largest net-new area** — nothing above the
Project/WorkItem level exists today. This is not a matter of extending an existing slice; it's a
new entity and a new pre-SDD lifecycle stage that the current 21-slice roadmap has never scoped at
all (the old blueprint's Slices 11-21 all operate *below* this level, assuming Project/WorkItem as
the entry point).

### §28-33 Hierarchy, Dependency, Work Graph, Work Item Detail, Blockers

| Concept | Current State | Status |
|---|---|---|
| Variable-depth work hierarchy (not hard-coded to Feature→Task→Subtask) | `WorkItem.parentId` self-relation (`schema.prisma:435-437`) has no depth limit; `addParentWorkItem` (`work-item/commands.ts:199`) walks the full ancestor chain for cycle detection at arbitrary depth. `WorkItemType` is only `PROJECT/TASK/BUG/CHANGE` (`schema.prisma:182`) — depth is structurally unlimited but not level-labeled (no "Initiative"/"Feature" type) | Aligned (schema) / Partial (query layer: `getWorkItemHierarchy` returns direct children only, no recursive tree fetch — `work-item/queries.ts:97-107`) |
| Hierarchy and Dependency modeled independently | `Dependency` (`schema.prisma:469`) is a fully separate model from `parentId`, with its own cycle detection (`dependency/commands.ts:24-56`) | **Aligned** — this is one of the few areas where current implementation already matches the new spec exactly |
| Multi-repository requirements (different Work Items → different Repository scopes, cross-repo dependencies) | `ProjectRepository` supports a Project linking multiple Repositories (Slice 12); nothing yet associates a specific WorkItem with a specific Repository subset, since Requirement doesn't exist | Partial |
| Visual Work Graph (hierarchy + dependency + parallel paths + status + blockers + AI/human state + owner + decision owner + approval + tests + changes + risk, expand/collapse, navigate) | `DependencyGraph.tsx` + `dependency/queries.ts:43-76`'s BFS (capped `MAX_GRAPH_NODES = 200`) render hierarchy+dependency+status for one item's neighborhood inside the 360° Record only — not project-wide, and doesn't overlay AI state/owner/decision-owner/tests/changes | Partial — matches old blueprint's Slice 16 (`project-wide-planner`, not started) |
| Work Item Detail (comprehensive: parent/children/deps/requirement/SDD context/sources/repos/owner/decision owner/status/approval/AI state/execution readiness/blockers/questions/decisions/tests/changes/source-control/timeline/next action) | 360° Record (`work-items/[id]/360/page.tsx`) already surfaces most of this list for what exists today (deps, blockers, decisions, evidence, timeline via audit, AI cost) — the gaps are exactly the fields that don't exist yet (Requirement link, Decision Owner, Execution Readiness, Change history, "next expected action") | Partial |
| Detailed Blockers (why/who/responsible/required action/criticality) | `Blocker` (`schema.prisma:482`) has `reason`, `ownerId`, `requiredAction`, `impact` (free text) — covers 4 of 5 fields already; no criticality/severity field | Partial |

### §34-41 Execution Readiness, Blocker Criticality, Autonomy, Approval Matrix

| Concept | Current State | Status |
|---|---|---|
| Execution Readiness (Approval + AI Readiness + Dependency Readiness + Required Inputs/Context + Policy Gates, distinct from Approval alone) | No composite readiness concept exists; the closest is `checkCompletionPolicy` (`evidence/completion.ts:10`), which gates **completion**, not **execution start** | Missing |
| Blocker criticality (Information/Warning/Soft/Hard) | Confirmed: no severity field anywhere on `Blocker`; `createBlocker` unconditionally sets `WorkItem.status = "BLOCKED"` regardless of any severity distinction (`blocker/commands.ts:59-62`) | Missing — implementation deferred (Part 2, Decision 7); when anything touches `Blocker` before this is built, keep the model open to adding a severity field later (e.g. don't hardcode assumptions that every Blocker behaves identically) |
| AI cannot arbitrarily create Hard Blockers — governed by Policy | No Policy engine exists to govern this at all (there is no severity concept to govern in the first place) | Missing — tied to Decision 7's deferral; needs the same future Policy engine |
| AI Autonomy configuration (per-action toggles: auto-advance, ask-before, create children, run tests, source-control ops, pause-on-failure, escalation triggers) | Zero matches for "autonomy" anywhere in code | Missing |
| Autonomy Hierarchy (Platform→Customer→Project→Feature→WorkItem, inherit unless overridden, hard restriction can't be bypassed downward) | The *pattern* already exists for AI budget: `getEffectiveBudget`'s Organization→Client→Project inheritance chain (`config/queries.ts`), `ConfigScope` enum (`schema.prisma:730`) — but `ConfigScope` stops at `PROJECT`, no `FEATURE`/`WORKITEM` scope exists, and it only ever governs one field (`aiBudgetUsd`) | Partial — starting depth resolved (Part 2, Decision 6): `Platform → Client → ...`, with everything below `Client` deliberately left flexible/extensible rather than a fixed Project/Feature/WorkItem chain |
| Autonomy recommendation by Risk/Complexity (non-binding) | `WorkItem.risk` (`RiskLevel` enum, `schema.prisma:201`) already exists and drives Attention Center's "high risk" grouping — no autonomy recommendation reads it yet | Partial |
| Approval Matrix (configurable which operations require approval; material-action-requires-approval-unless-pre-authorized) | Only the SDD pipeline's per-stage `approverRoles` gate policy exists (Slice 2) — general, non-pipeline "which operations need approval" configuration doesn't exist | Missing |
| Routine technical actions don't create approval fatigue | No equivalent concept — nothing distinguishes "routine" vs "material" actions today since there's no Approval Matrix | Missing |

This cluster maps most directly onto the old blueprint's Slice 21
(`configuration-center-generalization`, not started) — but that slice's one-line scope ("extend
beyond budget to the full field taxonomy") is now much better specified by §37-41: autonomy
toggles and an approval matrix are concrete, buildable extensions of the exact inheritance
mechanism Slice 6 already proved out.

### §42-53 Work Execution, Findings, Changes, Revisions, Child/Bulk Approval, Parent Completion

| Concept | Current State | Status |
|---|---|---|
| Work execution context assembly (SDD work + human decisions + repo/system context + current source + project rules, targeted not full-reload) | AI drafting today reads `Constitution` + prior stage content + prompt templates (Slice 2) — no Repository/System Context to draw on yet (see §8-13), and no explicit "targeted retrieval" contract | Partial |
| Unexpected Findings during execution (record/evidence/impact/recommendation/decision-maker/pause) | `AnalysisFinding` (`schema.prisma:619`) exists but is scoped only to the `ANALYZE` pipeline stage (severity + message + related stage) — not a general execution-time finding mechanism with evidence/impact/recommendation fields | Partial |
| AI may not silently change approved work — Change must be visible and governed | Confirmed: `updateWorkItem` (`work-item/commands.ts:127`) does a plain field overwrite; no revision number, no approved-vs-current distinction anywhere | Conflicts — design deliberately deferred (Part 2, Decision 5); the principle stands, but no Change/Revision system is being built yet |
| Change Diff (before/after: description/scope/children/dependencies/tests/repo impact/parent impact) | `FieldProvenance` (`schema.prisma:813`) tracks only *who last touched a field*, upserted (overwrites prior provenance, per its own comment) — not a before/after diff. `AuditEvent.detail` stores the new values submitted, not a before/after pair | Missing — deferred, see Decision 5 |
| Human editing that modifies approved work creates a controlled Change, not a silent overwrite | Confirmed absent — see "AI may not silently change approved work" above; applies equally to human edits today | Conflicts — deferred, see Decision 5 |
| Change as first-class work (hierarchically associated with the WorkItem that caused it, itself has children) | `WorkItemType.CHANGE` enum value exists (`schema.prisma:186`) but has **zero** special handling anywhere in the codebase (confirmed via grep — appears only in its two enum-literal declarations) | Missing (schema stub only, unused) — deferred, see Decision 5 |
| Change lifecycle (Change→Analysis→Impact Analysis→Questions/Decisions→Work Adjustment→Implementation→Tests→Completion) | No lifecycle exists for the unused `CHANGE` type | Missing — deferred, see Decision 5 |
| Work Item Revision (which revision approved, what changed, who/why, diff, current revision, re-approval needed) | No revisioning concept exists — see Change Diff above | Missing — deferred, see Decision 5 |
| Child Approval (see/open/review/approve children from Parent's list or the child's own detail view) | 360° Record shows dependencies and blockers, but no "children awaiting approval" panel with inline approve action exists | Missing |
| Bulk Approval ("Approve All Eligible," validates each child independently) | No bulk-approval action exists anywhere | Missing |
| Parent Completion blocked by unresolved Child problems, recursive | Confirmed absent: `checkCompletionPolicy` (`evidence/completion.ts:10`) checks only the target item's own evidence; grep for recursive-completion patterns (`children.*every`, `hasIncompleteChildren`) across `src/domain` returns zero matches — a parent can move to `COMPLETED` while children are still open | Conflicts |

This is the second-largest gap cluster after the Requirement lifecycle. "Change as first-class
work with revisions" (§44-50) has literally no starting point in the current schema beyond an
unused enum value — this is a genuinely new subsystem, not an extension.

### §54-56 Parallel AI Execution & Conflict Handling

| Concept | Current State | Status |
|---|---|---|
| Multiple AI Agents working in parallel (like concurrent developers) | `AgentRun` (`schema.prisma:674`) records one run per drafting attempt; nothing prevents or coordinates concurrent runs across different WorkItems today, but nothing detects meaningful overlap either | Missing (no active prevention, but also no detection) |
| Concurrency awareness (same file/module/contract/schema/API/test-env/shared deps) | No such detection exists | Missing |
| Conflict handling (where/which items/which files/what each side changed/why/consequences/options/recommendation, human decides material conflicts) | `SyncConflict` (`schema.prisma:832`) exists but is a **different kind of conflict** — field-level disagreement between manual edits and incoming external-tracker sync data (Slice 4), not concurrent-AI-agent code conflicts. The resolution UI pattern (`ConflictResolutionPanel`, `conflicts.ts`) is a reusable precedent for the new concept, but doesn't cover it today | Missing — resolved (Part 2, Decision 8): a dedicated new model, not a reuse/extension of `SyncConflict`; the existing resolution-UI *pattern* is still fair game to reuse |

### §57-62 Source-Control Activity & Testing

| Concept | Current State | Status |
|---|---|---|
| Source-control activity connected to Work Items (access/branch/file changes/commit/push/CR/review/comments/checks/conflict/merge) | `Commit`/`PullRequest`/`TestRun`/`Build`/`Deployment` (Slice 5) are real and visible on the 360° Record's Code & Changes / Tests tabs — covers commit/push/PR/checks. No `Branch`, no `Review Comment` entity | Aligned (core) / Partial (branch, review comments) |
| Testing belongs to the work definition and lifecycle | `TestRun` linked to `PullRequest`/`Repository` (Slice 5), visible per-WorkItem via `Evidence` | Aligned |
| Run Tests action (user-triggerable even if AI already ran tests) | No "Run Tests" UI action exists — `TestRun` rows are populated passively from GitHub webhook/catch-up fetch only, never user-triggered | Missing |
| Orchestrated test execution (platform determines which tests/repos/environment/revision/child-scope apply) | No orchestration layer exists — this presupposes the Run Tests action above | Missing |
| Hierarchical testing (Parent's "Run Tests" cascades to relevant Descendant tests) | No such cascade exists (and no orchestration to cascade in the first place) | Missing |
| Test Results (aggregate/by-child/cases/failures/logs/artifacts/environment/revision/execution time) | `TestRun` schema (`schema.prisma:949`) has status/timing fields; no "by child" aggregation since there's no orchestrated hierarchical run to aggregate | Partial |

### §63-68 Completion Assessment, Human Approval, Hierarchical Completion, Autonomous Progression

| Concept | Current State | Status |
|---|---|---|
| AI Completion Assessment (does AI believe this WorkItem satisfies its requirements) | No such explicit AI self-assessment step exists — `checkCompletionPolicy` is a deterministic evidence check (merged PR + passing tests), not an AI judgment call | Missing |
| Human Completion Approval as a distinct required gate | The `APPROVED → COMPLETED` transition itself requires the item already be in `APPROVED` status (a prior human gate), but there's no separate "approve this specific completed result" step distinct from the general status transition | Partial |
| Hierarchical completion (parent requires children completed + deps resolved + tests passed + no hard blockers + no unresolved conflicts, recursively) | Confirmed absent — see Parent Completion in §42-53 cluster above | Conflicts |
| Feature/Requirement-level validation reusing authoritative higher-level tests (no duplicate E2E definition) | No Requirement-level or Feature-level test concept exists yet (ties to Requirement being entirely missing) | Missing |
| Autonomous progression (Task A completes → policy allows → Task B auto-starts; pause on critical finding → human decision → resume) | No autonomous progression exists — every WorkItem status transition today is either a direct user action or (within a pipeline) the stage-gate flow; nothing auto-starts a sibling/next WorkItem on completion | Missing |
| Autonomous does not mean invisible (actions recorded, timeline updated, changes/source-control/tests/AI decisions stay visible, humans can inspect/pause anytime) | `AuditEvent` already guarantees this principle for everything it captures (Slice 1) — the principle is architecturally sound today, just has nothing autonomous yet to apply it to | Aligned (principle) / N/A (nothing autonomous exists yet) |

### §69-73 Timeline, Actor, Notifications

| Concept | Current State | Status |
|---|---|---|
| Work Item Timeline (creation/assignment/reassignment/decision-owner-transfer/AI start-pause/question/answer/approval/rejection/review/finding/blocker/change/source-change/commit/test/conflict/resolution/completion/reopen) | `AuditEvent` (`schema.prisma:1041`) already captures most of these categories as free-text `action` entries (~19 call sites across the domain layer per `audit/queries.ts:49-58`'s own comment) — real coverage, but not a fixed enum of event types, and "Decision Owner Transfer"/"Review" aren't distinct categories since those concepts don't exist yet | Partial |
| Actor (Human/AI Agent/System) on every significant event | `AuditEvent.actor` is a 3-value enum (`AuditActor`: SYSTEM/AI/USER, `schema.prisma:176`) — matches almost exactly, modulo "AI Agent" vs "AI" naming | Aligned |
| Human Attention Notifications (question/approval/review-required/conflict/hard-blocker/test-failure/ownership-transfer) | Attention Center already surfaces decisions/blockers/risks/deadlines/approval-gates/paused-clarifications/sync-conflicts (`attention/queries.ts:23-98`, 7 categories) — real overlap on decisions≈questions/approvals and blockers/conflicts, but no dedicated "review required" or "ownership transfer" category | Partial |
| Dashboard Attention (what/why/criticality/related item/required action, prominent) | Attention Center already does exactly this shape for its 7 categories (`attention/page.tsx`) | Aligned (for existing categories) |
| Push notifications (extensible delivery channel model) | Nothing exists — in-app Attention Center only, no push/email/webhook delivery | Missing |

### §74-77 AI Agent, Model Selection, Cost Visibility, Autonomy-Doesn't-Remove-Validation

| Concept | Current State | Status |
|---|---|---|
| AI Agent as a role/responsibility (Discovery/Analysis/Coding/Testing Agent), distinct from Model | Confirmed: `Agent` (`schema.prisma:658`) is a `(provider, model, name)` tuple — an Agent row *is* a model binding, not an independent role. Routing (`resolveStageAgentId`, `agent/commands.ts:57`) is per-`StageType` (CONSTITUTION/SPEC/PLAN/TASKS/CLARIFY/ANALYZE/IMPLEMENT/DEPLOY), which is the closest existing analog to "role," but it's tied 1:1 to a pipeline stage, not a freely assignable role with Purpose/Instructions/Allowed-Actions/Restrictions/Tools/Escalation-Rules | Conflicts — the terminology and the binding direction are both different from the spec's model |
| Model Selection per work (capability/quality/cost/privacy/context/risk/policy factors, not one Model per Agent) | Today's `Agent.model` is a static, admin-configured single value per Agent row — there's no per-work dynamic model selection at all | Missing — granularity resolved (Part 2, Decision 9): selection happens **per AI operation/request**, not once per Requirement; different operations within the same Requirement may use different models, optimizing cost/tokens per operation (old blueprint's Slice 20, `ai-model-knowledge-snapshot`, targets this — not started) |
| AI cost visibility (Agent/Model/Provider/Tokens/Cost/Duration/WorkItem/Run) | `AgentRun` (`schema.prisma:674`) already tracks every one of these fields, with real cost rollups and budget enforcement (Slice 3) | **Aligned** — near-exact match to the spec's own field list |
| Autonomy doesn't remove validation (autonomy changes *who* must approve, not *whether* conditions are checked) | No autonomy exists yet to test this principle against, but the pattern is consistent with how `checkCompletionPolicy` already works (a deterministic, non-bypassable check regardless of who triggers the transition) | Aligned (principle, by construction) / N/A (autonomy itself missing) |

### §78-82 Audit, Customer Dashboard, Requirement View, Attention Center

| Concept | Current State | Status |
|---|---|---|
| Audit (entity/action/actor/actor-type/timestamp/previous-state/new-state/reason/related work item/run/decision) | `AuditEvent` (`schema.prisma:1041`) covers entity-adjacent fields (projectId/workItemId), actor+actorName, timestamp, free-text action/detail — but **no structured previous-state/new-state pair** (only the new values, via `detail`) | Partial |
| Customer Dashboard (sources/repos/context-status/requirements/active projects/active work/progress/blockers/questions/approvals/reviews/risks/AI activity/test status/recent decisions) | Today's Dashboard (`src/app/page.tsx`) covers projects/blockers-via-attention/AI cost/recent audit events per client — no Requirements (don't exist), no Context Status (Discovery doesn't exist), no Sources-as-a-list view | Partial |
| Requirement View (original requirement/discovery status/relevant systems/repos/risks/questions/decisions/SDD status/work graph/progress/blockers/timeline) | No Requirement entity exists to have a view | Missing |
| Attention Center as Questions/Approvals/Reviews/Conflicts/Critical-Blockers/Responsibility-Transfers | Today's 7 categories (Decisions/Blockers/Risks/Deadlines/Approval-gates/Paused-clarifications/Sync-conflicts, `attention/queries.ts:23-98`) partially map: Decisions≈Questions+Approvals (conflated), Paused-clarifications≈Questions (pipeline-scoped only), Sync-conflicts≈Conflicts (different conflict type, see §54-56), Blockers has no criticality split for "Critical." No "Reviews" or "Responsibility Transfers" category exists | Partial — real infrastructure, needs recategorization once Question/Approval/Review split (see Part 2, Q4) |

### §83-86 Scope Boundaries & Interpretation Principles

| Concept | Current State | Status |
|---|---|---|
| Stops at Implementation Complete; Release/Deploy/Production/Rollback/Monitoring explicitly out of scope | Matches the current product's own boundary — nothing in the existing roadmap (Slices 0-21) touches production deployment either | Aligned |
| "Do not..." interpretation principles (§86) | These are architectural discipline rules for *future* work, not a capability to inventory — see Part 2 for how each interacts with the open questions below | N/A (guidance, not a feature) |

---

## Part 2 — Terminology & structural decisions (resolved 2026-08-17)

Nine open questions were surfaced here; the user answered all nine the same day. Recorded below in
the original Q1-Q9 numbering, each as: the resolved direction, then the reasoning/implications
worth carrying into whichever future slice touches that area. None of this has been implemented —
these are recorded decisions governing future scoping, not a green light to build them now.

**Decision 1 (was Q1) — "Customer" was a naming mistake. Keep `Client`.**
No new entity. The existing `Organization → Client → Project` hierarchy is unchanged. Every place
in the source spec (`docs/roadmap-sources/2026-08-17-core-product-definition.md`) that says
"Customer" should be read as "Client" going forward — this analysis's own Part 1 rows have been
updated accordingly (see §3-7). This resolves what was the single most consequential open question,
since everything else in the spec was described as living "under a Customer."

**Decision 2 (was Q2) — `Connection` is a new, deliberately flexible/extensible concept.**
Not a straight rename of `Connector`. A `Connection` may represent different technical connectivity
types — CLI, MCP, source-control Connectors, GitHub, generic APIs, etc. — and one `Connection` may
expose multiple `Source`s. The taxonomy of Connection/Source types is explicitly **not** locked down
now — do not design a closed enum for this when it's eventually scoped; whatever slice builds this
should keep the type set open/extensible rather than repeating `IntegrationType`'s closed-enum
pattern. This does mean Slice 13's `Connector.clientId` + `IntegrationType` expansion may need
reshaping once this is actually built, not just extended in place.

**Decision 3 (was Q3) — `Requirement` is a flexible intake item, not scoped under `Project`.**
A Requirement can represent a Project, Task, Bug, Change, or another type — it's a flexible intake
shape, not a fixed schema. It may arrive via manual entry or from an external source. It can be
**standalone**, or **optionally linked** to an existing Project — never *required* to belong to one.
This resolves the placement question: Requirement sits alongside/above Project as its own entry
point into the system, not nested under it.

**Decision 4 (was Q4) — Question/Approval/Review: extend the existing three models, not a
full rename/merge, but keep the shape open to change.**
Asked to choose the cleanest approach while staying flexible for the future: the recommended
direction is to extend `Decision`/`Approval`/`ClarifyQuestion` in place with the fields the spec
requires (evidence, possible options, blocking/non-blocking status, explicit decision owner) rather
than introducing brand-new `Question`/`Review` models or renaming existing ones. This is the lowest-
disruption path (Attention Center, 360° Record, and every pipeline gate keep working against the
same three models) while still making Question/Approval/Review substantively distinguishable by
field, not just by convention. This is a recommendation to revisit at actual design time, not a
locked schema — keep it easy to split further later if the extended-in-place shape turns out to be
too conflated in practice.

**Decision 5 (was Q5) — Change/Revision system: explicitly deferred.**
Do not design the final Change/Revisions/Diffs model yet. `WorkItemType.CHANGE` stays an unused
enum stub for now. Revisit once the product is more mature — likely once enough real work has moved
through the system that the actual shape of "what needs to diff against what" is informed by real
usage rather than speculation. Nothing in the interim should make this harder to add later (e.g.,
avoid designs that assume in-place field overwrites are permanent and unrecoverable).

**Decision 6 (was Q6) — Autonomy hierarchy starts at `Platform → Client → ...`, rest flexible.**
The launch depth is two firm levels (Platform, Client); everything below Client (Project/Feature/
WorkItem or whatever levels turn out to be right) stays flexible/extensible rather than a hardcoded
three-more-levels commitment. The exact hierarchy below Client will be defined later — whichever
slice eventually builds this should not lock in Project→Feature→WorkItem as the only possible
sub-Client levels.

**Decision 7 (was Q7) — Blocker severity: defer the implementation, keep the architecture ready.**
Don't add a `soft`/`hard` enum to `Blocker` yet — but don't design anything in the meantime that
would make adding one later awkward (e.g., code that treats every Blocker as unconditionally
equivalent in a way a future severity field couldn't cleanly override). This is a lighter-weight
version of deferral than Decision 5: the field itself is cheap and can land whenever a Policy engine
exists to actually govern hard-blocker overrides, per §36.

**Decision 8 (was Q8) — Parallel-AI-agent Conflicts get a dedicated new model.**
Confirmed: do not reuse or extend `SyncConflict` — that model represents a different, unrelated
concept (external-tracker field disagreement, Slice 4). The new Conflict model is for concurrent-
AI-agent code/file/schema conflicts (§54-56 of the source spec). The existing resolution-UI pattern
(`ConflictResolutionPanel`) is still fair game to reuse visually, just not the underlying data model.

**Decision 9 (was Q9, expanded) — Model selection happens per AI operation, not per Requirement.**
Different operations within the same Requirement (or the same WorkItem, or the same pipeline) may
use different models. The goal is optimizing cost and token usage while still picking an appropriate
model for each specific operation — not selecting one model once and using it for everything
downstream. This sharpens (rather than resolves outright) the original "Agent as role vs. Model"
question: whatever eventually reshapes `Agent`/`AgentRun`/`resolveStageAgentId` needs to support
model selection at the operation level, which is a stronger requirement than just "per Agent" or
"per Requirement."

---

## Part 3 — Relationship to the existing Slices 14-21 stubs

| Slice | Old blueprint scope | New spec sections it now maps to | Assessment |
|---|---|---|---|
| **14** — `repository-sdd-bootstrap` | One paragraph (§5.3): connect-time SDD check + bootstrap pass | §8-13 (Repository Onboarding/Discovery/Context/Maintenance, System Context/Reconciliation) | **Needs re-scoping** — the new spec is far more detailed and adds System Context as a separate concept the old blueprint never named. Do not start Slice 14 from its old one-paragraph scope. |
| **15** — `repository-relevance-recommendation` | AI recommends relevant repos/sources for new Project/Task | §17 (Impact Discovery) partially overlaps, but Impact Discovery is framed as a Requirement-scoped scan, not a Project/Task-scoped recommendation | **Needs re-scoping** — now that Requirement placement is resolved (Part 2, Decision 3: standalone or optionally linked to a Project), its trigger point likely moves from "creating a Project/Task" to "Requirement Triage," with the Project-linked case as one path through it. |
| **16** — `project-wide-planner` | Dependency map + status board + focus + parallel, project-scoped | §31 (Visual Work Graph) — close conceptual match, but the new spec's graph explicitly overlays Owner/Decision-Owner/Approval/Tests/Changes, which the old blueprint's Slice 16 didn't call out | **Still roughly accurate, extend field set** — least disrupted of the eight. |
| **17** — `ai-recommendation-card` | Shared what/why/assumptions/estimate card, applied to executor recommendation | Touches §19 (AI Questions), §37-39 (Autonomy), broadly consistent | **Still roughly accurate** — the card pattern itself isn't contradicted by the new spec, though it should incorporate Blocker criticality (§35) and Execution Readiness (§34) once those exist. |
| **18** — `task-decomposition-approval` | Materialize `TASKS` stage output into real child WorkItems, any qualifying type | §26-27 (SDD → Authoritative Work → Structured Platform Representation → Visual Work Graph) — strong match | **Still roughly accurate**, but should decompose from a Requirement's SDD output once Requirement exists (Decision 3), not only from a WorkItem's own pipeline. |
| **19** — `cascading-assignment-with-conflict-detection` | Project-level assignment cascade, owner-decides conflict prompt | §23 (Responsibility Transfer) is related but broader — covers both Ownership and Decision Ownership transfer across the whole hierarchy, not just cascading assignment | **Needs re-scoping** — should likely be reframed as the general Responsibility Transfer mechanism §23 describes, with cascading assignment as one instance of it. |
| **20** — `ai-model-knowledge-snapshot` | Weekly Claude-docs fetch + model recommendation | §75 (Model Selection) — good match, but §74 (AI Agent as role) reframes what's selecting the model | **Needs re-scoping** — Decision 9 confirmed model selection must happen per AI operation/request (not per Agent, not per Requirement), which is a stronger requirement than this slice's original one-recommendation-per-execution framing; the weekly-snapshot fetch itself is unaffected, but the recommendation-consumption side needs the operation-level granularity built in from the start. |
| **21** — `configuration-center-generalization` | Extend Configuration Center beyond budget to a general field taxonomy | §37-41 (Autonomy Hierarchy, Approval Matrix) give this slice a much more concrete shape than "generalize beyond budget" | **Needs re-scoping, but in a good way** — Decision 6 sets the starting depth (`Platform → Client → flexible below`), so this slice's `ConfigScope` extension now has a concrete, bounded first target instead of an open-ended five-level commitment; approval matrix work can proceed independently. |

No slice above is marked cancelled or definitively rewritten — this table is the mapping for a
future scoping pass to work from. The nine open questions that used to block that pass are now
resolved (Part 2); actually re-scoping and proposing any of Slices 14-21 is still a separate,
later step — not part of this update.
