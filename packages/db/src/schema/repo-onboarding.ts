import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgPolicy, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { client, repo } from "./tenancy.ts";
import { users } from "./identity.ts";

/**
 * Repository onboarding as a coach (`openspec/changes/repository-coach`):
 * one run per attempt to prepare a repository for Claude Code — an isolated
 * worktree, a deterministic diagnosis, the repository's own processes, a
 * trial run, a plan of components each with its evidence, a build that is
 * verified per component, and delivery to git in the person's identity.
 * After the run, the coach keeps proposing from what real sessions show.
 *
 * Every table here is tenant-scoped (`client_id` + RLS) except
 * `marketplace_source`, which is org-shared knowledge like `prompt_template`.
 * Every action a run takes is also written to `repo_ai_event` through
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
    /** onboarding — the whole process; coach — a short run that applies proposals the coach made. */
    kind: text("kind").notNull().default("onboarding"),
    /** Pending | Running | WaitingForUser | Completed | Failed | Cancelled */
    status: text("status").notNull().default("Pending"),
    currentStepKey: text("current_step_key"),
    workspacePath: text("workspace_path"),
    defaultBranch: text("default_branch"),
    baselineSha: text("baseline_sha"),
    branchName: text("branch_name"),
    /** `{ level: reversible_auto | all_approval | locked }` — how much the run does without asking. */
    automation: jsonb("automation").notNull().default(sql`'{}'::jsonb`),
    /** The `/init` draft session inside the plan step: id, state, launch args, last status-line snapshot, transcript cursor. */
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

export const repositoryOnboardingStep = pgTable(
  "repository_onboarding_step",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => repositoryOnboardingRun.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    stepKey: text("step_key").notNull(),
    stepOrder: integer("step_order").notNull(),
    /** Pending | Running | WaitingForUser | Completed | Failed | Cancelled */
    status: text("status").notNull().default("Pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    result: jsonb("result"),
    errors: jsonb("errors").notNull().default(sql`'[]'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("repository_onboarding_step_run_key_uq").on(t.runId, t.stepKey),
    index("repository_onboarding_step_run_order_idx").on(t.runId, t.stepOrder),
    tenantPolicy("repository_onboarding_step_tenant_isolation"),
  ],
).enableRLS();

/** What the diagnosis found — one row per run, kept so the coach and the next run can read it without diagnosing again. */
export const repoProfile = pgTable(
  "repo_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id").notNull().references(() => repo.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    runId: uuid("run_id").notNull().references(() => repositoryOnboardingRun.id, { onDelete: "cascade" }),
    baselineSha: text("baseline_sha"),
    /** The profile as `diagnose.ts` produced it. */
    profile: jsonb("profile").notNull(),
    /** Facts the person marked wrong: `[{ path, note, by, at }]`. */
    corrections: jsonb("corrections").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("repo_profile_repo_idx").on(t.repoId, t.createdAt), unique("repo_profile_run_uq").on(t.runId), tenantPolicy("repo_profile_tenant_isolation")],
).enableRLS();

/** A process of the repository (how a change of some kind is made here), broken into steps, each with its agent test and decision. */
export const onboardingProcess = pgTable(
  "onboarding_process",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => repositoryOnboardingRun.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    /** git | ci | contributing | pr_template | docs | tracker | interview | model */
    source: text("source").notNull(),
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    /** `ProcessStep[]` — each with its agent test and decision. */
    steps: jsonb("steps").notNull().default(sql`'[]'::jsonb`),
    trialTaskKey: text("trial_task_key"),
    /** Why the process cannot be exercised here, when it cannot. */
    impossible: text("impossible"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("onboarding_process_run_key_uq").on(t.runId, t.key), tenantPolicy("onboarding_process_tenant_isolation")],
).enableRLS();

/** One trial task's outcome, before (baseline) or after the build. */
export const onboardingTrial = pgTable(
  "onboarding_trial",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => repositoryOnboardingRun.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    /** baseline | after */
    phase: text("phase").notNull(),
    taskKey: text("task_key").notNull(),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    passed: boolean("passed"),
    /** missing_fact | rule_violated | needs_external | cannot_verify | bad_judgment */
    failureKind: text("failure_kind"),
    detail: text("detail").notNull().default(""),
    answer: text("answer").notNull().default(""),
    judgedBy: text("judged_by").notNull().default(""),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    callId: uuid("call_id"),
    /** The measurement (onboarding-proves-itself): the n-th run of this task in this phase, how many turns it took, what each code grader found, and which components the task exercises. */
    runIndex: integer("run_index").notNull().default(0),
    numTurns: integer("num_turns"),
    graders: jsonb("graders").notNull().default(sql`'[]'::jsonb`),
    exercises: jsonb("exercises").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("onboarding_trial_run_idx").on(t.runId, t.phase), index("onboarding_trial_task_idx").on(t.runId, t.phase, t.taskKey, t.runIndex), tenantPolicy("onboarding_trial_tenant_isolation")],
).enableRLS();

/** A component card: why (the evidence), what, source, group, risk, its decision, what was written for it and how it was verified. */
export const onboardingComponent = pgTable(
  "onboarding_component",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => repositoryOnboardingRun.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    family: text("family").notNull(),
    title: text("title").notNull(),
    why: text("why").notNull(),
    what: text("what").notNull(),
    /** rule | trial | process | marketplace | reviewer | user | init | coach */
    source: text("source").notNull(),
    sourceRef: text("source_ref"),
    /** auto | approval | not_recommended */
    group: text("group").notNull(),
    /** reversible | significant | external */
    risk: text("risk").notNull(),
    contextTokens: integer("context_tokens"),
    verifyHow: text("verify_how").notNull().default(""),
    /** proposed | approved | declined | installed | verified | failed | removed | deferred | reported */
    status: text("status").notNull().default("proposed"),
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
    files: jsonb("files").notNull().default(sql`'[]'::jsonb`),
    validation: jsonb("validation"),
    delta: jsonb("delta"),
    questions: jsonb("questions").notNull().default(sql`'[]'::jsonb`),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    declineReason: text("decline_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("onboarding_component_run_key_uq").on(t.runId, t.key), index("onboarding_component_run_idx").on(t.runId, t.family), tenantPolicy("onboarding_component_tenant_isolation")],
).enableRLS();

/** What the coach proposes after the run, from real sessions: an addition, a change, a removal, or something new in the world. */
export const repoCoachProposal = pgTable(
  "repo_coach_proposal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id").notNull().references(() => repo.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    /** add | change | remove | new_in_world */
    kind: text("kind").notNull(),
    componentKey: text("component_key"),
    title: text("title").notNull(),
    why: text("why").notNull(),
    evidence: jsonb("evidence").notNull().default(sql`'{}'::jsonb`),
    /** The measure that triggered it and its value, so the effect can be read after the proposal is applied. */
    measure: jsonb("measure").notNull().default(sql`'{}'::jsonb`),
    /** proposed | approved | declined | applied | measured */
    status: text("status").notNull().default("proposed"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    declineReason: text("decline_reason"),
    /** The run that applied it. */
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("repo_coach_proposal_repo_idx").on(t.repoId, t.status), tenantPolicy("repo_coach_proposal_tenant_isolation")],
).enableRLS();

/**
 * A source of ready-made components the open search found (a plugin, an MCP
 * server, a skills library, an LSP plugin), with the trust checks the code
 * ran on it. Org-shared, no RLS: what was learned searching for one
 * repository's stack serves the next repository with the same stack, and a
 * weekly re-check keeps it current. Never a client's content — a name, an
 * address and the checks.
 */
export const marketplaceSource = pgTable(
  "marketplace_source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** plugin | mcp | skill | lsp | marketplace */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    publisher: text("publisher"),
    description: text("description"),
    /** Stack tags the source serves (`dotnet`, `dataverse`, `terraform`, …). */
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    /** official | known_community | unverified */
    trust: text("trust").notNull().default("unverified"),
    trustChecks: jsonb("trust_checks").notNull().default(sql`'{}'::jsonb`),
    toolCount: integer("tool_count"),
    contextTokens: integer("context_tokens"),
    /** model — the open search; catalog — the operator's list; person. */
    foundBy: text("found_by").notNull().default("model"),
    usedInRepos: integer("used_in_repos").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when a re-check found the source changed (a new version, new tools) — the coach's "new in the world". */
    changedAt: timestamp("changed_at", { withTimezone: true }),
  },
  (t) => [unique("marketplace_source_kind_url_uq").on(t.kind, t.url)],
);

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
    /** `onboarding.<subject>.<verb>` / `coach.<subject>.<verb>` — see `eventLabel` in the web screen for the full list. */
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    actorUserId: uuid("actor_user_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("repo_ai_event_repo_idx").on(t.repoId, t.occurredAt), tenantPolicy("repo_ai_event_tenant_isolation")],
).enableRLS();
