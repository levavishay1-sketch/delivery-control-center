import { sql } from "drizzle-orm";
import {
  boolean,
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
import {
  blockerState,
  executor,
  gapState,
  priority,
  riskLevel,
  taskAppetite,
  taskState,
  workitemKind,
  workitemLevel,
  workitemPhase,
} from "./enums.ts";
import { client, project, repo } from "./tenancy.ts";
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
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    /**
     * Short human key, e.g. "WI-1284". Stable, unique, used in branch
     * names (`feature/WI-1284-slug`) so hooks can resolve the WorkItem
     * from git. Assigned on create; mirrors the ADO id where there is one.
     */
    key: text("key").unique(),
    level: workitemLevel("level").notNull().default("story"),
    kind: workitemKind("kind").notNull().default("task"),
    phase: workitemPhase("phase").notNull().default("intake"),
    priority: priority("priority").notNull().default("medium"),
    risk: riskLevel("risk").notNull().default("low"),
    executor: executor("executor").notNull().default("human"),
    /** Per-WorkItem AI spend ceiling. Null = falls back to the project/client budget. */
    budgetUsd: numeric("budget_usd", { precision: 10, scale: 2 }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    /** 0..100 rollup of task completion, cached for list views. */
    progressPct: integer("progress_pct").notNull().default(0),
    title: text("title").notNull(),
    /** Null until an ADO work item is linked. ADO is SoT once linked (architecture §8). */
    linkedAdoId: integer("linked_ado_id"),
    /** True once someone chose to start building with gaps still open. Surfaced loudly. */
    startedWithOpenBlocker: boolean("started_with_open_blocker").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("workitem_project_idx").on(t.projectId),
    index("workitem_owner_idx").on(t.ownerId),
    // F-6: workitem's client must equal its project's client
    foreignKey({
      columns: [t.projectId, t.clientId],
      foreignColumns: [project.id, project.clientId],
      name: "workitem_project_client_fk",
    }),
    // …and let gap/task/blocker enforce the same against workitem
    unique("workitem_id_client_uq").on(t.id, t.clientId),
    tenantPolicy("workitem_tenant_isolation"),
  ],
).enableRLS();

/** Which repos a WorkItem touches — from declared affected areas + live branches. */
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
    description: text("description").notNull(),
    blocking: boolean("blocking").notNull().default(false),
    /** 0..1 — never binary. Shown as a meter, not a percentage (architecture UI §3). */
    confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
    state: gapState("state").notNull().default("proposed"),
    /** Set when verified/dismissed — who made the human call. */
    resolvedBy: uuid("resolved_by").references(() => users.id),
    /** When spun off, the WorkItem it became. */
    spunOffTo: uuid("spun_off_to").references((): any => workitem.id),
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
    intent: text("intent").notNull(),
    /** Given/When/Then acceptance criteria, structured. */
    acceptance: jsonb("acceptance")
      .$type<{ given: string; when: string; then: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    appetite: taskAppetite("appetite").notNull().default("standard"),
    state: taskState("state").notNull().default("pending"),
    /** OpenSpec change id this task belongs to, when applicable. */
    openspecChangeId: text("openspec_change_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_workitem_idx").on(t.workitemId, t.seq),
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
 * A per-client AI-spend budget, and the running total. The dashboard's
 * "AI cost" meter reads this; `spentUsd` is bumped whenever a
 * model.routed / claude.session event carries a cost.
 */
export const clientBudget = pgTable(
  "client_budget",
  {
    clientId: uuid("client_id")
      .primaryKey()
      .references(() => client.id, { onDelete: "cascade" }),
    monthlyUsd: numeric("monthly_usd", { precision: 10, scale: 2 }).notNull().default("300"),
    spentUsd: numeric("spent_usd", { precision: 10, scale: 2 }).notNull().default("0"),
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
