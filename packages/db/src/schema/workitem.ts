import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  blockerState,
  executor,
  gapState,
  priority,
  requirementType,
  riskLevel,
  taskAppetite,
  taskState,
  workitemPhase,
  workitemType,
} from "./enums.ts";
import { client, repo } from "./tenancy.ts";
import { users } from "./identity.ts";

const tenantPolicy = (name: string) =>
  pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: "public",
    using: sql`client_id = current_setting('app.current_client', true)::uuid`,
    withCheck: sql`client_id = current_setting('app.current_client', true)::uuid`,
  });

/**
 * The central entity. A generic container that accretes events over time
 * (architecture §2) — NOT a fixed pipeline. `phase` is only the coarse
 * bucket; the rich status is derived from open gaps/blockers/tasks.
 *
 * `clientId` is denormalised from `project` so RLS and partition keys
 * have it directly (architecture decision 04 risk mitigation: scope by
 * workitem.client_id, always).
 */
export const workitem = pgTable(
  "workitem",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    /**
     * Parent requirement. NULL = a top-level requirement (what used to be
     * a "project"). RESTRICT: detach or move children before deleting.
     */
    parentId: uuid("parent_id").references((): AnyPgColumn => workitem.id, { onDelete: "restrict" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    /**
     * Short human key, e.g. "WI-1284". Stable, unique, used in branch
     * names (`feature/WI-1284-slug`) so hooks can resolve the WorkItem
     * from git. Assigned on create; mirrors the ADO id where there is one.
     */
    key: text("key").unique(),
    /** ADO/TFS work item type — one field (was kind × level). */
    type: workitemType("type").notNull().default("story"),
    /** DCC-internal flow-control axis, orthogonal to `type` (`requirement-types`).
     *  `research`/`testing` requirements are not yet given a different flow in the
     *  UI — the field exists and is settable, but `WorkflowTab`/Flow-card-size
     *  consequences described in that proposal are still open design questions
     *  (0.2/0.3 in its tasks.md), deliberately not guessed at here. */
    requirementType: requirementType("requirement_type").notNull().default("development"),
    phase: workitemPhase("phase").notNull().default("intake"),
    priority: priority("priority").notNull().default("medium"),
    risk: riskLevel("risk").notNull().default("low"),
    executor: executor("executor").notNull().default("human"),
    /** Per-requirement AI spend ceiling. Null = falls back to the client budget. */
    budgetUsd: numeric("budget_usd", { precision: 10, scale: 2 }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    /** 0..100 rollup of task completion, cached for list views. */
    progressPct: integer("progress_pct").notNull().default(0),
    title: text("title").notNull(),
    /** Null until an ADO work item is linked. ADO is SoT once linked (architecture §8). */
    linkedAdoId: integer("linked_ado_id"),
    /** The ADO work item's own URL — stored once at link time (same pattern as `task.adoUrl`) so every place that shows this requirement's TFS reference can link straight to it, not just display the number. */
    adoUrl: text("ado_url"),
    /** ADO area path this requirement syncs under. NULL = inherit from parent / client. */
    adoAreaPath: text("ado_area_path"),
    /** True once someone chose to start building with gaps still open. Surfaced loudly. */
    startedWithOpenBlocker: boolean("started_with_open_blocker").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("workitem_client_idx").on(t.clientId),
    index("workitem_parent_idx").on(t.parentId),
    index("workitem_owner_idx").on(t.ownerId),
    // lets gap/task/blocker enforce "same client all the way down"
    unique("workitem_id_client_uq").on(t.id, t.clientId),
    tenantPolicy("workitem_tenant_isolation"),
  ],
).enableRLS();

/**
 * Which repos a requirement touches. Two sources:
 *   link_kind = 'declared' — a person picked it (the manual path)
 *   link_kind = 'auto'     — inferred from live branches / affected areas
 */
export const workitemRepo = pgTable(
  "workitem_repo",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    workitemId: uuid("workitem_id")
      .notNull()
      .references(() => workitem.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repo.id, { onDelete: "cascade" }),
    linkKind: text("link_kind").notNull().default("declared"),
    addedBy: uuid("added_by"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workitemId, t.repoId] }),
    tenantPolicy("workitem_repo_tenant_isolation"),
  ],
).enableRLS();

/**
 * A Gap: an AI-proposed missing piece or ambiguity. A PROPOSAL until a
 * human verifies it (architecture §4). Classified blocking / non-blocking;
 * a non-blocking gap can be spun off into its own WorkItem.
 */
export const gap = pgTable(
  "gap",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    workitemId: uuid("workitem_id")
      .notNull()
      .references(() => workitem.id, { onDelete: "cascade" }),
    /** The QUESTION itself — phrased so a person can answer it, not an observation. */
    description: text("description").notNull(),
    /** One short line: why this matters. */
    why: text("why"),
    /** "business" | "technical" | "missing_info" | "new_scope" — what kind of decision this is. */
    kind: text("kind").notNull().default("missing_info"),
    /**
     * "client" = only the person who asked for the requirement can decide
     * (a business call); "team" = we can decide it ourselves. Getting this
     * fork wrong is what builds the wrong thing, so it is explicit.
     */
    whoAnswers: text("who_answers").notNull().default("team"),
    /** Candidate answers the reader can pick instead of writing one. */
    options: jsonb("options").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** One short line: what breaks if we guess and guess wrong. */
    impactIfWrong: text("impact_if_wrong"),
    blocking: boolean("blocking").notNull().default(false),
    /** 0..1 — never binary. Shown as a meter, not a percentage (architecture UI §3). */
    confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
    state: gapState("state").notNull().default("proposed"),
    /** Set when verified/dismissed — who made the human call. */
    resolvedBy: uuid("resolved_by").references(() => users.id),
    /** The decision itself (resolved) or the reason it isn't a real gap (dismissed) — also mirrored into a timeline note, but kept here so the closed-gap list can show it without a timeline search. */
    answer: text("answer"),
    /**
     * When spun off, the WorkItem it became. SET NULL, not the default
     * (NO ACTION/restrict): deleting the spun-off requirement should never
     * be blocked by — or silently take down — the gap that spawned it; the
     * gap just loses the pointer and keeps its own history.
     */
    spunOffTo: uuid("spun_off_to").references((): any => workitem.id, { onDelete: "set null" }),
    /** The event that proposed this gap — back-link for traceability. */
    proposedByEvent: uuid("proposed_by_event"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("gap_workitem_idx").on(t.workitemId),
    foreignKey({
      columns: [t.workitemId, t.clientId],
      foreignColumns: [workitem.id, workitem.clientId],
      name: "gap_workitem_client_fk",
    }),
    tenantPolicy("gap_tenant_isolation"),
  ],
).enableRLS();

/**
 * A Task: the unit of decomposition. The contract is
 * { intent, acceptance (Given/When/Then), affected_areas, dependencies,
 * appetite }. OpenSpec is the X behind this Y (architecture §5).
 */
export const task = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    workitemId: uuid("workitem_id")
      .notNull()
      .references(() => workitem.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    /**
     * "task" — real work, becomes a TFS work item.
     * "check" — verification / regression / documentation needed to call
     * the parent task done. Never its own TFS item; folded into the
     * parent's Discussion (System.History) on materialize. Always a leaf,
     * always has a parentTaskId pointing at a "task" node, never counted
     * toward the ladder depth.
     */
    kind: text("kind").notNull().default("task"),
    intent: text("intent").notNull(),
    /** Given/When/Then acceptance criteria, structured. */
    acceptance: jsonb("acceptance")
      .$type<{ given: string; when: string; then: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    appetite: taskAppetite("appetite").notNull().default("standard"),
    state: taskState("state").notNull().default("pending"),
    /**
     * Check-kind rows only. Set from Claude's own structured report when a
     * check ran (bundled with its parent task, or on its own) — this is
     * the FACTUAL result, never a human decision. `checkResolvedBy` is the
     * separate signal for "a person looked at this and decided" (approved
     * despite failure, or otherwise overrode the reported result) — a
     * null `checkResolvedBy` means the current result is exactly what
     * Claude reported, unmodified.
     */
    checkResult: text("check_result"),
    checkResolvedBy: uuid("check_resolved_by").references(() => users.id),
    checkResolvedAt: timestamp("check_resolved_at", { withTimezone: true }),
    /** How this task was created: 'ai' (a breakdown proposal) or 'human'. */
    origin: text("origin").notNull().default("human"),
    /** Set when a person has approved this task + its content (AI proposals need this). */
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    /**
     * The exact instruction Claude runs for this task. Written by the
     * breakdown, editable before approval, executed verbatim by the
     * implementation run — so the handoff is reviewable, not implicit.
     */
    prompt: text("prompt"),
    /** Files the breakdown expects this task to touch. */
    affectedPaths: jsonb("affected_paths").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** For each expected file, the compiled projects/plugins that
     *  reference it — "what do I actually need to build and deploy" once
     *  this task ships, distinct from `affectedPaths` (what changes) and
     *  a run's `affectedConsumers` (other code that calls into it). Set
     *  by the breakdown prompt, since only reading the real repo can
     *  answer this. */
    compiledComponents: jsonb("compiled_components").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /**
     * Check-kind rows only: whether this check is currently in play.
     * Toggling it off drops it from the next preview/run of its parent's
     * prompt and from the completion gate, without losing its history —
     * toggling it back on clears any stale prior result, since it needs
     * fresh verification.
     */
    active: boolean("active").notNull().default(true),
    /** Set when a check-driven state change moves this task OUT of
     *  `done` (a check got reactivated, or started failing again) — so
     *  once its checks are all resolved again, the task returns to
     *  `done` on its own instead of sitting in `failed_checks` forever. */
    wasDone: boolean("was_done").notNull().default(false),
    /**
     * What this task's branch was created from, recorded when it is created
     * (see `task-base.ts`). `baseTaskId` is the dependency whose branch it
     * starts from when that work is not in the default branch yet — null
     * when it starts from the default branch. `baseSha` is the commit it
     * starts from: the task's own work is `baseSha..branch`, and rolling it
     * back returns there. `builtWithout` lists the dependencies whose work
     * was not in that base, so the screen can say when it is worth
     * developing again. All cleared on rollback — the next run decides anew.
     */
    baseTaskId: uuid("base_task_id").references((): AnyPgColumn => task.id, { onDelete: "set null" }),
    baseBranch: text("base_branch"),
    baseSha: text("base_sha"),
    builtWithout: jsonb("built_without").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /**
     * Task hierarchy. The DEPTH of this tree picks the TFS work-item type
     * off the Agile ladder Epic > Feature > User Story > Task, anchored at
     * the bottom: a 1-deep breakdown is all Tasks, 2-deep is User Story +
     * Task, 3-deep adds Feature, 4-deep adds Epic.
     */
    /**
     * RESTRICT, not cascade: a parent with children (real sub-tasks, or
     * checks) must never disappear silently and take an already-approved,
     * already-implemented, or already-TFS-linked subtree down with it.
     * `deleteTask` walks and clears the subtree itself, surgically, before
     * the row delete — see its comment.
     */
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => task.id, { onDelete: "restrict" }),
    /** The TFS work-item type this task materialises as (from the ladder). */
    adoType: text("ado_type"),
    /** Tasks — NOT requirements — are what lives in TFS. */
    linkedAdoId: integer("linked_ado_id"),
    adoUrl: text("ado_url"),
    adoSyncedAt: timestamp("ado_synced_at", { withTimezone: true }),
    /** OpenSpec change id this task belongs to, when applicable. */
    openspecChangeId: text("openspec_change_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_workitem_idx").on(t.workitemId, t.seq),
    index("task_parent_idx").on(t.parentTaskId),
    index("task_ado_idx").on(t.linkedAdoId),
    foreignKey({
      columns: [t.workitemId, t.clientId],
      foreignColumns: [workitem.id, workitem.clientId],
      name: "task_workitem_client_fk",
    }),
    tenantPolicy("task_tenant_isolation"),
  ],
).enableRLS();

/** Task → Task dependency, with the reason it exists (architecture §14). */
export const taskDependency = pgTable(
  "task_dependency",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    dependsOnTaskId: uuid("depends_on_task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    /** Why — links back to the Requirement/Gap that created this edge. */
    reason: text("reason"),
    originGapId: uuid("origin_gap_id").references(() => gap.id),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnTaskId] }),
    tenantPolicy("task_dependency_tenant_isolation"),
  ],
).enableRLS();

/**
 * A Bug requirement (`workitem.type = "bug"`) linked to the task(s) it's
 * actually about — decided 2026-09-12 (`bug-change-request-lifecycle`):
 * a Bug can be linked to a task as its structure (a bug ON that task's
 * work), OR stand alone with no link at all. Many-to-many on purpose:
 * live verification against the connected Azure DevOps server
 * (`wit/workitemrelationtypes`) found `System.LinkTypes.Related` marked
 * `singleTarget: true`, but that field describes whether the SAME pair
 * of work items can carry the link twice, not how many DIFFERENT work
 * items one item can relate to — day-to-day ADO usage (and its own
 * product UI) allows a work item many distinct "Related" links, which
 * is the behavior this table is modeling. A Bug's own linked tasks are
 * what its breakdown inherits existing check tasks from (a Change
 * Request does NOT inherit — decided the same day, it's a fresh
 * category like a task, not a Bug).
 */
export const bugTaskLink = pgTable(
  "bug_task_link",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    bugId: uuid("bug_id")
      .notNull()
      .references(() => workitem.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.bugId, t.taskId] }),
    tenantPolicy("bug_task_link_tenant_isolation"),
  ],
).enableRLS();

/**
 * The active-edit map (architecture §7, layer 2). Which files each
 * active WorkItem is touching, per repo — fed from declared affected
 * areas and from live branches. Overlap here is a soft warning, never a
 * gate: worktree isolation means work never physically collides; the
 * decision is at merge time.
 */
export const workitemFileTouch = pgTable(
  "workitem_file_touch",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    workitemId: uuid("workitem_id")
      .notNull()
      .references(() => workitem.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repo.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    branch: text("branch"),
    /** "declared" (affected-areas) | "branch" (actually changed) */
    kind: text("kind").notNull().default("declared"),
    lastTouchedAt: timestamp("last_touched_at", { withTimezone: true }).notNull().defaultNow(),
    /** Cleared when the WorkItem's branch merges / the item closes. */
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.workitemId, t.repoId, t.path] }),
    index("wft_repo_path_idx").on(t.repoId, t.path).where(sql`released_at is null`),
    tenantPolicy("workitem_file_touch_tenant_isolation"),
  ],
).enableRLS();

/**
 * A structured code review (architecture §9). The Reviewer is a
 * separate hat from the Writer — it checks the overlap region and the
 * mechanics, and is a layer BEFORE human approval, not instead of it.
 */
export const review = pgTable(
  "review",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    workitemId: uuid("workitem_id")
      .notNull()
      .references(() => workitem.id, { onDelete: "cascade" }),
    prRef: text("pr_ref"),
    /** "pass" | "changes_requested" */
    verdict: text("verdict").notNull(),
    /** [{ file, line?, severity, note }] — mechanical findings for the human to weigh */
    findings: jsonb("findings")
      .$type<{ file: string; line?: number; severity: "info" | "warn" | "block"; note: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The overlap region the reviewer was told to focus on, if any. */
    overlapFocus: jsonb("overlap_focus").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    byUserId: uuid("by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("review_workitem_idx").on(t.workitemId),
    tenantPolicy("review_tenant_isolation"),
  ],
).enableRLS();

/**
 * WorkItem → WorkItem dependency. Drives the project Flow view, and must
 * also be written to ADO as a native predecessor/successor link so the
 * picture is consistent for anyone looking straight at ADO
 * (architecture §15). `kind` mirrors ADO link semantics.
 */
export const workitemDependency = pgTable(
  "workitem_dependency",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    workitemId: uuid("workitem_id")
      .notNull()
      .references(() => workitem.id, { onDelete: "cascade" }),
    dependsOnWorkitemId: uuid("depends_on_workitem_id")
      .notNull()
      .references(() => workitem.id, { onDelete: "cascade" }),
    /** "predecessor" (default) | "parent" | "related" */
    kind: text("kind").notNull().default("predecessor"),
    reason: text("reason"),
    originGapId: uuid("origin_gap_id").references(() => gap.id),
    /** Set once the matching link exists in ADO. */
    adoLinkSyncedAt: timestamp("ado_link_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workitemId, t.dependsOnWorkitemId] }),
    index("workitem_dependency_from_idx").on(t.workitemId),
    index("workitem_dependency_to_idx").on(t.dependsOnWorkitemId),
    tenantPolicy("workitem_dependency_tenant_isolation"),
  ],
).enableRLS();

/**
 * A Blocker: Claude stopped mid-task and needs an answer. A structured
 * object — not a chat (architecture §13). Routed to the WorkItem owner,
 * answered in a focused UI, answer returned to Claude.
 */
export const blocker = pgTable(
  "blocker",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    workitemId: uuid("workitem_id")
      .notNull()
      .references(() => workitem.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => task.id, { onDelete: "set null" }),
    /** "missing_access" | "unclear_requirement" | "budget_exceeded" | ... */
    questionType: text("question_type").notNull(),
    question: text("question").notNull(),
    routedTo: uuid("routed_to")
      .notNull()
      .references(() => users.id),
    answer: text("answer"),
    answeredBy: uuid("answered_by").references(() => users.id),
    state: blockerState("state").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (t) => [
    index("blocker_open_idx").on(t.routedTo).where(sql`state = 'open'`),
    foreignKey({
      columns: [t.workitemId, t.clientId],
      foreignColumns: [workitem.id, workitem.clientId],
      name: "blocker_workitem_client_fk",
    }),
    tenantPolicy("blocker_tenant_isolation"),
  ],
).enableRLS();

/**
 * A notification — something that wants a person's attention. Feeds the
 * "Attention Center" nav and the dashboard's recent-alerts panel.
 */
export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    forUserId: uuid("for_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workitemId: uuid("workitem_id").references(() => workitem.id, { onDelete: "cascade" }),
    /** "blocker" | "budget" | "decision" | "deadline" | "review" | "gap" */
    kind: text("kind").notNull(),
    severity: text("severity").notNull().default("info"), // info | warn | critical
    title: text("title").notNull(),
    body: text("body"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_user_idx").on(t.forUserId, t.createdAt),
    tenantPolicy("notification_tenant_isolation"),
  ],
).enableRLS();

/**
 * A per-client AI-spend budget. The spend itself is never stored here: the
 * dashboard's "AI cost" meter and the budgets screen sum `claude_call`
 * (claude-in-dcc §8.2), from `periodStart` on.
 */
export const clientBudget = pgTable(
  "client_budget",
  {
    clientId: uuid("client_id")
      .primaryKey()
      .references(() => client.id, { onDelete: "cascade" }),
    monthlyUsd: numeric("monthly_usd", { precision: 10, scale: 2 }).notNull().default("300"),
    /** The spend itself is a sum over `claude_call` since here — never cached (claude-in-dcc §8.2). */
    periodStart: timestamp("period_start", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantPolicy("client_budget_tenant_isolation")],
).enableRLS();

/**
 * The Context Brief: a compact, always-current derived summary per
 * WorkItem, injected into a fresh Claude session via the SessionStart
 * hook (architecture §10). Regenerated incrementally on each new event.
 */
export const contextBrief = pgTable(
  "context_brief",
  {
    workitemId: uuid("workitem_id")
      .primaryKey()
      .references(() => workitem.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    /** Markdown. What a new session loads instead of replaying the timeline. */
    body: text("body").notNull(),
    /** event_log id this brief is current as of. */
    currentAsOfEvent: uuid("current_as_of_event"),
    modelUsed: text("model_used"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [tenantPolicy("context_brief_tenant_isolation")],
).enableRLS();

/**
 * A file attached to a requirement. DCC holds the bytes itself, so a
 * client with no Azure DevOps connection can still attach a spec — and
 * so the assess/breakdown prompt can carry what the file actually says
 * (`extracted_text`). When there IS a connection the file is mirrored to
 * TFS as well and `ado_url` points at it. `source` = where it came from.
 */
export const attachment = pgTable(
  "attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    workitemId: uuid("workitem_id")
      .notNull()
      .references(() => workitem.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** ADO attachment GUID (from the relation url), for dedup on pull. */
    adoAttachmentId: text("ado_attachment_id"),
    /** ADO attachment content url (needs auth) — what we link to. */
    adoUrl: text("ado_url"),
    /** The file itself. NULL for a row pulled from TFS, whose bytes stayed there. */
    content: customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" })("content"),
    /** What the file says, for the prompt. NULL ⇒ not readable as text. */
    extractedText: text("extracted_text"),
    /** Why there is no text (an image, a scanned PDF) — shown, never guessed at. */
    extractError: text("extract_error"),
    sizeBytes: integer("size_bytes"),
    source: text("source").notNull().default("dcc"), // dcc | ado
    addedBy: uuid("added_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attachment_workitem_idx").on(t.workitemId),
    tenantPolicy("attachment_tenant_isolation"),
  ],
).enableRLS();

/**
 * One background call to the local `claude` CLI (assess / breakdown).
 * `log` is the running activity transcript; it survives the user
 * leaving the screen and is kept as history. NO RLS on purpose — it is
 * written as single auto-committed statements (never inside a withTenant
 * transaction, which PGlite's single connection can't nest), and the
 * API tenant-checks the workitem before reading it.
 */
export const flowRun = pgTable(
  "flow_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "cascade" }),
    workitemId: uuid("workitem_id").notNull().references(() => workitem.id, { onDelete: "cascade" }),
    /** Set when the run is about one task (implementation) rather than the requirement. */
    taskId: uuid("task_id"),
    kind: text("kind").notNull(), // assess | breakdown | implement
    state: text("state").notNull().default("running"), // running | done | error
    log: jsonb("log").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    result: jsonb("result"),
    error: text("error"),
    startedBy: uuid("started_by"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("flow_run_workitem_idx").on(t.workitemId, t.startedAt),
    index("flow_run_task_idx").on(t.taskId, t.startedAt),
  ],
);
