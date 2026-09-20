import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgPolicy, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { client, repo } from "./tenancy.ts";
import { users } from "./identity.ts";

/**
 * Repository onboarding — one run per attempt to prepare a repository for
 * Claude Code: an isolated worktree, Claude Code's own `/init` in a live
 * session, the person's review of every change, and delivery to git
 * (`openspec/changes/repository-onboarding-native-init`).
 *
 * Every table here is tenant-scoped (`client_id` + RLS), and every action
 * a run takes is also written to `repo_ai_event` through
 * `appendRepoAiEvent()` — never a raw INSERT.
 */

const tenantPolicy = (name: string) =>
  pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: "public",
    using: sql`client_id = current_setting('app.current_client', true)::uuid`,
    withCheck: sql`client_id = current_setting('app.current_client', true)::uuid`,
  });

export const repositoryOnboardingRun = pgTable(
  "repository_onboarding_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id").notNull().references(() => repo.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    /** Pending | Running | WaitingForUser | Completed | Failed | Cancelled */
    status: text("status").notNull().default("Pending"),
    currentStageKey: text("current_stage_key"),
    workspacePath: text("workspace_path"),
    defaultBranch: text("default_branch"),
    baselineSha: text("baseline_sha"),
    branchName: text("branch_name"),
    /** Which stages start by themselves and whether the review gate waits for a person. */
    automation: jsonb("automation").notNull().default(sql`'{}'::jsonb`),
    /** Per-AI-stage model/effort overrides of the routing recommendation. */
    modelChoices: jsonb("model_choices").notNull().default(sql`'{}'::jsonb`),
    /** The Claude Code session: id, state, launch args, last status-line snapshot, transcript cursor. */
    session: jsonb("session").notNull().default(sql`'{}'::jsonb`),
    triggeredBy: uuid("triggered_by").notNull().references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("repository_onboarding_run_repo_idx").on(t.repoId, t.startedAt),
    uniqueIndex("repository_onboarding_run_live_uq").on(t.repoId).where(sql`status in ('Pending','Running','WaitingForUser')`),
    tenantPolicy("repository_onboarding_run_tenant_isolation"),
  ],
).enableRLS();

export const repositoryOnboardingStage = pgTable(
  "repository_onboarding_stage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => repositoryOnboardingRun.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    stageKey: text("stage_key").notNull(),
    stageOrder: integer("stage_order").notNull(),
    /** Pending | Running | WaitingForUser | Completed | Failed | Cancelled */
    status: text("status").notNull().default("Pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    result: jsonb("result"),
    errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
    /** Session cost at the stage's start and end, and the model/effort in use. */
    usage: jsonb("usage").notNull().default(sql`'{}'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("repository_onboarding_stage_run_key_uq").on(t.runId, t.stageKey),
    index("repository_onboarding_stage_run_order_idx").on(t.runId, t.stageOrder),
    tenantPolicy("repository_onboarding_stage_tenant_isolation"),
  ],
).enableRLS();

/**
 * Repository-scoped audit trail. Deliberately not `event_log`: that table is
 * WorkItem-scoped by design (one append-only timeline per WorkItem), and a
 * repository-level action often has no WorkItem to attach to. Same "no
 * silent actions" principle at Repository scope — only `appendRepoAiEvent()`
 * writes here.
 */
export const repoAiEvent = pgTable(
  "repo_ai_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id").notNull().references(() => repo.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    /** `onboarding.<subject>.<verb>` — see `eventLabel` in the web screen for the full list. */
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    actorUserId: uuid("actor_user_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("repo_ai_event_repo_idx").on(t.repoId, t.occurredAt), tenantPolicy("repo_ai_event_tenant_isolation")],
).enableRLS();
