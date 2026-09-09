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
  gapState,
  taskAppetite,
  taskState,
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
    phase: workitemPhase("phase").notNull().default("intake"),
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
