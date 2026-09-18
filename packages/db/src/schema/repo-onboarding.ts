import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgPolicy, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { client, repo } from "./tenancy.ts";
import { users } from "./identity.ts";

/**
 * Repository AI Enablement — persisted state for the onboarding pipeline.
 *
 * v2 (`repository-ai-enablement-v2`): a 9-stage, resumable state machine
 * with a per-run automation policy, an artifact ledger (what DCC put in
 * the repository, why, and how to tell when it goes stale), and the
 * Claude execution / prompt-versioning infrastructure every stage plugs
 * into. Runs written by the previous 16-stage pipeline carry
 * `onboarding_version = 'v1'` and are read-only history — they can be
 * viewed and cancelled but never advanced by the v2 state machine.
 *
 * The old `repo_ai_*` tables (repo-ai.ts) are left in place as inert
 * history (dropping them is a data-retention decision, not a code one);
 * only `repo_ai_event` is still written, as the repository-scoped audit
 * trail.
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
    /** The stage key currently Running/WaitingForUser/AwaitingExternal/Failed; null once the run is terminal. */
    currentStageKey: text("current_stage_key"),
    /** Pipeline-schema version tag. `'v1'` = the retired 16-stage pipeline
     *  (read-only history); `'v2'` = the current 9-stage pipeline. */
    onboardingVersion: text("onboarding_version").notNull().default("v1"),
    /** `'initial'` — first onboarding of this repo; `'refresh'` — an
     *  incremental re-run seeded from `previous_run_id` after the repo changed. */
    mode: text("mode").notNull().default("initial"),
    previousRunId: uuid("previous_run_id"),
    /** The run's automation policy (`AutomationPolicy` in @dcc/core) — which
     *  stages run without a click and which gates a person must answer.
     *  Editable while the run is live; every change is an event. */
    automation: jsonb("automation").notNull().default(sql`'{}'::jsonb`),
    /** Per-stage model/effort overrides (`ModelPolicy` in @dcc/core) — a
     *  person's explicit choice for an AI stage, keyed by stage key. A stage
     *  missing here just uses the policy's recommendation. Editable while
     *  the run is live, same as `automation`. */
    modelChoices: jsonb("model_choices").notNull().default(sql`'{}'::jsonb`),
    /** A reviewer's "request changes" note, carried into the next generate pass. */
    reviewNote: text("review_note"),
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
      .where(sql`status in ('Pending','Running','WaitingForUser','AwaitingExternal')`),
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
 * The artifact ledger — one row per artifact an onboarding run planned
 * for the repository (created, updated, or deliberately skipped). This is
 * DCC's side of "the repository is the source of truth": the files live
 * in the repo, the ledger records why each exists, what it costs in
 * always-loaded context, which paths it depends on (so a later refresh
 * can tell deterministically whether it MAY be stale), and the content
 * hash at the time DCC wrote it (so an edit made outside DCC is detected
 * rather than silently overwritten).
 */
export const repositoryAiArtifact = pgTable(
  "repository_ai_artifact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => repositoryOnboardingRun.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id").notNull().references(() => repo.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    /** Stable id within the run's plan (e.g. "claude_md", "skill:repo-map"). */
    artifactKey: text("artifact_key").notNull(),
    /** claude_md | nested_claude_md | rule | knowledge_skill | workflow_skill | agent | settings | guardrail_hook | dcc_hooks */
    kind: text("kind").notNull(),
    path: text("path").notNull(),
    /** create | update | skip | remove */
    action: text("action").notNull(),
    /** always | on_demand | never — what the artifact costs Claude's context. */
    loading: text("loading").notNull(),
    justification: text("justification").notNull().default(""),
    /** Lifecycle stages that consume it, e.g. ["planning","implementation"]. */
    consumers: jsonb("consumers").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Repository paths whose change makes this artifact a refresh candidate. */
    watchedPaths: jsonb("watched_paths").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    sourceOfTruth: text("source_of_truth"),
    estimatedTokens: integer("estimated_tokens"),
    lines: integer("lines"),
    contentHash: text("content_hash"),
    /** planned | written | dropped | validated */
    status: text("status").notNull().default("planned"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("repository_ai_artifact_run_key_uq").on(t.runId, t.artifactKey),
    index("repository_ai_artifact_repo_idx").on(t.repoId, t.createdAt),
    tenantPolicy("repository_ai_artifact_tenant_isolation"),
  ],
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
    /** `--effort` actually used for this call — the policy's recommendation
     *  unless a person overrode it on the run's `model_choices`. */
    effort: text("effort"),
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
