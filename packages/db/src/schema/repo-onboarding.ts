import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgPolicy, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { client, repo } from "./tenancy.ts";
import { users } from "./identity.ts";

/**
 * Repository AI Enablement — Phase 1 (core infrastructure only).
 *
 * Full replace (design discussion, 2026-09-16) of `repo-ai.ts`'s 3-step
 * onboarding flow (scan/deny-rules/`/init`), per a 36-section spec the
 * user supplied: a 16-stage, resumable, GitHub-PR-based onboarding
 * pipeline. This file covers only what Phase 1 needs — the persisted
 * state machine, the deterministic scanner's output, and the Claude
 * execution/prompt-versioning infrastructure later stages plug into.
 * Stages 3-16's own tables (if any) are a Phase 2+ concern.
 *
 * The old `repo_ai_*` tables (repo-ai.ts) are deliberately left
 * untouched — migrating/backfilling them is an explicitly deferred
 * decision, not part of this pass.
 */

const tenantPolicy = (name: string) =>
  pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: "public",
    using: sql`client_id = current_setting('app.current_client', true)::uuid`,
    withCheck: sql`client_id = current_setting('app.current_client', true)::uuid`,
  });

/** Pending | Running | WaitingForUser | Completed | CompletedWithWarnings | Failed | Skipped | Cancelled.
 *  Shared status vocabulary between a run and its stages. Text, not a pg
 *  enum — this repo's own convention for any value set expected to keep
 *  evolving (see `repoAiProfile.state`'s identical reasoning). */

/**
 * One row per onboarding run. `id` doubles as the run-id embedded in the
 * onboarding branch name (`ai/repository-onboarding/<id>`) and in the
 * isolated worktree's directory name.
 */
export const repositoryOnboardingRun = pgTable(
  "repository_onboarding_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id").notNull().references(() => repo.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("Pending"),
    /** The stage key currently Running/WaitingForUser/Failed; null once the run is terminal. */
    currentStageKey: text("current_stage_key"),
    /** Pipeline-schema version tag — `'legacy'` is reserved for a future backfill of
     *  repos onboarded under the old 3-step flow; Phase 1 only ever writes `'v1'`. */
    onboardingVersion: text("onboarding_version").notNull().default("v1"),
    /** 'worktree' | 'clone' — which isolation strategy `ensureOnboardingWorkspace` actually used. */
    workspaceKind: text("workspace_kind"),
    workspacePath: text("workspace_path"),
    defaultBranch: text("default_branch"),
    baselineSha: text("baseline_sha"),
    branchName: text("branch_name"),
    triggeredBy: uuid("triggered_by").notNull().references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("repository_onboarding_run_repo_idx").on(t.repoId, t.startedAt),
    /** DB-level guard: at most one live (non-terminal) run per repo at a time —
     *  on top of, not instead of, the per-run workspace isolation in workspace.ts. */
    uniqueIndex("repository_onboarding_run_live_uq")
      .on(t.repoId)
      .where(sql`status in ('Pending','Running','WaitingForUser')`),
    tenantPolicy("repository_onboarding_run_tenant_isolation"),
  ],
).enableRLS();

/**
 * One row per (run, stage) — updated IN PLACE on retry, not re-inserted.
 * This is the entire resumability mechanism: re-entering a run after a
 * failure is just "find the first stage in STAGE_ORDER whose row here
 * isn't Completed/CompletedWithWarnings/Skipped" — no special-cased
 * "resume from N" logic anywhere.
 */
export const repositoryOnboardingStage = pgTable(
  "repository_onboarding_stage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => repositoryOnboardingRun.id, { onDelete: "cascade" }),
    /** Denormalized from the run — RLS needs it directly on this row, a join won't satisfy the policy. */
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    stageKey: text("stage_key").notNull(),
    /** Index into STAGE_ORDER at the time this row was created. */
    stageOrder: integer("stage_order").notNull(),
    status: text("status").notNull().default("Pending"),
    attempt: integer("attempt").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Version/hash of what this stage actually consumed (prompt version + upstream
     *  results + baseline SHA) — lets a future incremental refresh check staleness. */
    inputVersion: text("input_version"),
    /** Stage-specific output shape — each stage owns its own `result` shape. */
    result: jsonb("result"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    errors: jsonb("errors").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Null for deterministic stages (both of Phase 1's own stages are deterministic). */
    claudeExecutionId: uuid("claude_execution_id"),
    sourceCommitSha: text("source_commit_sha"),
    /** Append-only array of past-attempt summaries ({attempt, startedAt, completedAt,
     *  status, errors}), pushed here just before this row is overwritten for a retry. */
    history: jsonb("history").notNull().default(sql`'[]'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("repository_onboarding_stage_run_key_uq").on(t.runId, t.stageKey),
    index("repository_onboarding_stage_run_order_idx").on(t.runId, t.stageOrder),
    tenantPolicy("repository_onboarding_stage_tenant_isolation"),
  ],
).enableRLS();

/**
 * Deterministic repository-scanner output. One row per RUN (not one
 * mutable row per repo) — a repo scanned across two runs gets two rows,
 * which is exactly what a future incremental-refresh diff needs.
 */
export const repositoryProfile = pgTable(
  "repository_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().unique().references(() => repositoryOnboardingRun.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id").notNull().references(() => repo.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    scannedCommitSha: text("scanned_commit_sha").notNull(),
    languages: jsonb("languages").notNull().default(sql`'[]'::jsonb`),
    buildSystems: jsonb("build_systems").notNull().default(sql`'[]'::jsonb`),
    testSignals: jsonb("test_signals").notNull().default(sql`'[]'::jsonb`),
    ciSignals: jsonb("ci_signals").notNull().default(sql`'[]'::jsonb`),
    frameworkSignals: jsonb("framework_signals").notNull().default(sql`'[]'::jsonb`),
    docsSignals: jsonb("docs_signals").notNull().default(sql`'[]'::jsonb`),
    /** { pattern, reason: "junk_dir" | "junk_extension" }[] — where the existing
     *  `scanForJunk` dir/extension detection (moved in from repo-ai/permissions.ts) lands. */
    ignoredPaths: jsonb("ignored_paths").notNull().default(sql`'[]'::jsonb`),
    stats: jsonb("stats").notNull().default(sql`'{}'::jsonb`),
    warnings: jsonb("warnings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("repository_profile_repo_idx").on(t.repoId, t.createdAt), tenantPolicy("repository_profile_tenant_isolation")],
).enableRLS();

/**
 * Prompt versioning for the onboarding pipeline. A NEW table, deliberately
 * not an extension of the existing `prompt_template` (prompts.ts): that
 * table mutates `body` in place with zero history — correct for its own
 * assess/breakdown/retro use case, which must not be disturbed — but a
 * `claude_execution` row needs to keep resolving to the EXACT text that
 * actually ran even after someone edits the prompt later, which requires
 * immutable, versioned rows. No RLS — org-shared config, same reasoning
 * as `prompt_template` itself.
 */
export const onboardingPromptTemplate = pgTable(
  "onboarding_prompt_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable identifier across versions, e.g. "onboarding.classify_stack". */
    promptKey: text("prompt_key").notNull(),
    version: integer("version").notNull(),
    /** Which stage_key this belongs to. */
    stage: text("stage").notNull(),
    title: text("title").notNull(),
    /** `{{PLACEHOLDER}}` tokens — rendered by the existing `renderPrompt()` helper verbatim. */
    body: text("body").notNull(),
    defaultModel: text("default_model"),
    active: boolean("active").notNull().default(false),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("onboarding_prompt_template_key_version_uq").on(t.promptKey, t.version),
    /** DB-enforced "exactly one active version per key." */
    uniqueIndex("onboarding_prompt_template_active_uq").on(t.promptKey).where(sql`active is true`),
  ],
);

/**
 * One row per actual `ClaudeCodeRunner.run()` call. `id` doubles as the
 * execution/runId passed straight into `runClaudeRaw`'s `opts.runId`, so
 * the existing exported `stopFlowRun`/`sendRunMessage` cancellation
 * machinery already works against it — no second registry needed.
 */
export const repositoryOnboardingClaudeExecution = pgTable(
  "repository_onboarding_claude_execution",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => repositoryOnboardingRun.id, { onDelete: "cascade" }),
    stageKey: text("stage_key").notNull(),
    repoId: uuid("repo_id").notNull().references(() => repo.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    /** The exact immutable prompt version that was sent. */
    promptTemplateId: uuid("prompt_template_id").notNull().references(() => onboardingPromptTemplate.id, { onDelete: "restrict" }),
    model: text("model"),
    /** 'read_only_plan' | 'accept_edits' — the abstracted profile name; never a raw CLI flag. */
    permissionProfile: text("permission_profile").notNull(),
    denyRulesSnapshot: jsonb("deny_rules_snapshot").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("Running"),
    resultText: text("result_text"),
    resultJson: jsonb("result_json"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    durationMs: integer("duration_ms"),
    numTurns: integer("num_turns"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("repository_onboarding_claude_execution_run_idx").on(t.runId, t.stageKey),
    tenantPolicy("repository_onboarding_claude_execution_tenant_isolation"),
  ],
).enableRLS();
