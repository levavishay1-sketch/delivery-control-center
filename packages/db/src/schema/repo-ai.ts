import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgPolicy, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { client, repo } from "./tenancy.ts";

/**
 * Repository AI Management (`repository-ai-management`).
 *
 * Scope decided with the user (2026-09-14): a Repository belongs to
 * exactly one Client — no shared-profile model, unlike `repo` itself
 * (which CAN be client_id NULL for org-shared libraries). Starting AI
 * management on a NULL-client repo is rejected at the application layer
 * (`repo-ai/profile.ts`), not modelled here as a schema-level NULL case.
 *
 * The Repository is the source of truth for which AI components
 * actually exist in it (Skills, Agents, MCPs, hooks, …) — DCC keeps no
 * second physical copy of a Skill's own files. What DCC stores is a
 * SYNCED representation: `ai_component` is the global, org-shared
 * catalog (a component appears here the moment ANY repo has it, and
 * disappears once NO repo has it any more); `repo_ai_component_link` is
 * the per-repo, per-sync evidence of "this repo currently has this
 * component" (or had it, until a later sync found it gone).
 */

const tenantPolicy = (name: string) =>
  pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: "public",
    using: sql`client_id = current_setting('app.current_client', true)::uuid`,
    withCheck: sql`client_id = current_setting('app.current_client', true)::uuid`,
  });

/**
 * One row per managed Repository. `client_id` is copied from `repo` at
 * the moment management starts (never NULL here — see scope note above)
 * so this table can carry the same tenant RLS policy as everything else.
 */
export const repoAiProfile = pgTable(
  "repo_ai_profile",
  {
    repoId: uuid("repo_id").primaryKey().references(() => repo.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    /** NOT_MANAGED | INVENTORY_PENDING | KNOWLEDGE_PENDING | MANAGED | REVIEW_DUE | BLOCKED — text,
     *  not a pg enum: state names are an internal detail this feature will keep refining. */
    state: text("state").notNull().default("NOT_MANAGED"),
    /** Free text — set together with a BLOCKED state; cleared on any transition out of it. */
    blockedReason: text("blocked_reason"),
    lastInventorySyncAt: timestamp("last_inventory_sync_at", { withTimezone: true }),
    lastInventorySyncCommit: text("last_inventory_sync_commit"),
    lastKnowledgeSnapshotId: uuid("last_knowledge_snapshot_id"),
    /** Onboarding step 2 (design discussion, 2026-09-16): the `Read` deny
     *  patterns a human approved for this repo — suggested from a
     *  deterministic scan (build/vendored directory names actually found),
     *  editable before approval. `null` until approved; every AI call this
     *  feature makes against the repo (init, knowledge generation) REFUSES
     *  to run until this is set — the lock is enforced server-side, not
     *  only by the UI hiding the button. */
    denyRules: jsonb("deny_rules").$type<string[]>(),
    denyRulesApprovedAt: timestamp("deny_rules_approved_at", { withTimezone: true }),
    denyRulesApprovedBy: uuid("deny_rules_approved_by"),
    /** Onboarding step 3 done-marker — set once `/init` completes (or is
     *  deliberately skipped because a CLAUDE.md already existed). */
    bootstrapCompletedAt: timestamp("bootstrap_completed_at", { withTimezone: true }),
    reviewDueAt: timestamp("review_due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [tenantPolicy("repo_ai_profile_tenant_isolation")],
).enableRLS();

/**
 * The global, org-shared AI component catalog (no RLS — same reasoning
 * as `repo`/`prompt_template`: this is cross-client config, not tenant
 * data). A row here is entirely DERIVED from `repo_ai_component_link`:
 * created the first time any repo's sync detects it, `last_seen_at`
 * bumped on every sync that still finds it somewhere, and left in place
 * (not deleted) once no repo has it any more — the catalog is a record
 * of "components the org has ever used", matching the decided model
 * ("only when Skill X no longer exists in any Repository should it
 * disappear from the global library" — read literally that would delete
 * the row; kept instead as a dormant/zero-repo row so its history,
 * title edits and description survive a temporary removal-and-re-add.
 * `activeRepoCount` in the read layer is computed live, never trust a
 * denormalized count here).
 */
export const aiComponent = pgTable(
  "ai_component",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** skill | agent | mcp | hook | command | methodology | tool | template | base_configuration | plugin | other.
     *  Text, not a pg enum — new types must not require a migration. */
    type: text("type").notNull(),
    /** Stable identity for dedup across syncs: `${type}:${normalized-name}`. Not shown in UI. */
    key: text("key").notNull(),
    /** Human-editable display name — renaming this never breaks `key` matching. */
    title: text("title").notNull(),
    description: text("description"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("ai_component_key_uq").on(t.key)],
);

/**
 * "Repo R's last sync found component C at path P." One row per
 * (repo, component) pair; a sync that no longer finds a previously-seen
 * component sets `active=false` + `removed_at` rather than deleting the
 * row, so "this repo used to have X" stays visible (design mirrors
 * `task.active` from `task-inactive-tfs-sync`, same session precedent).
 */
export const repoAiComponentLink = pgTable(
  "repo_ai_component_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id").notNull().references(() => repo.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    componentId: uuid("component_id").notNull().references(() => aiComponent.id, { onDelete: "restrict" }),
    /** Where in the repo this was detected — e.g. "skills/gap-report/SKILL.md". */
    detectedPath: text("detected_path").notNull(),
    active: boolean("active").notNull().default(true),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    unique("repo_ai_component_link_uq").on(t.repoId, t.componentId, t.detectedPath),
    index("repo_ai_component_link_repo_idx").on(t.repoId),
    tenantPolicy("repo_ai_component_link_tenant_isolation"),
  ],
).enableRLS();

/**
 * One Knowledge Baseline generation for a Repository — the accumulated,
 * evidence-backed understanding DCC keeps SEPARATE from the components
 * themselves (decided: do not confuse this with storing copies of
 * Skills/Agents/MCPs — this table describes the repo, it isn't a mirror
 * of its tooling). Storage is deliberately just structured DB rows for
 * now, not committed into the client's own repo — flexible to change
 * later (decided: "keep the architecture flexible enough that the final
 * physical storage/materialization strategy can be adjusted later").
 * Each generation is a new row (append pattern, like `claude.session`
 * cost events) — never overwritten in place, so history/freshness
 * comparisons stay possible.
 */
export const repoKnowledgeSnapshot = pgTable(
  "repo_knowledge_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id").notNull().references(() => repo.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    analyzedCommit: text("analyzed_commit"),
    previousSnapshotId: uuid("previous_snapshot_id"),
    /** CREATE_BASELINE | UPDATE_BASELINE | REASSESS_EXISTING. */
    mode: text("mode").notNull().default("CREATE_BASELINE"),
    /** fresh | affected | refresh_required | stale | unknown. */
    freshnessStatus: text("freshness_status").notNull().default("fresh"),
    /** { overview, architecture, components, delivery, risks } — each a Markdown string.
     *  jsonb, not five columns: keeps the section set adjustable without a migration. */
    sections: jsonb("sections").notNull().default(sql`'{}'::jsonb`),
    /** Which of the sections above were actually produced this run (vs carried over). */
    coverage: jsonb("coverage").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    model: text("model"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    durationMs: integer("duration_ms"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    generatedBy: uuid("generated_by"),
  },
  (t) => [index("repo_knowledge_snapshot_repo_idx").on(t.repoId, t.generatedAt), tenantPolicy("repo_knowledge_snapshot_tenant_isolation")],
).enableRLS();

/**
 * A proposal to change a Repository's AI setup — deliberately a much
 * lighter shape than the full research-backed "decision package" the
 * source spec describes for an automated P3A/P3B engine (not built this
 * pass, see implementation report). What IS built: a Recommendation is
 * always human-created or system-flagged with a reason, always requires
 * an explicit Decision before anything happens, and nothing in this
 * table alone ever changes a Repository — matches the "no silent
 * actions" non-negotiable exactly like the rest of DCC.
 */
export const repoAiRecommendation = pgTable(
  "repo_ai_recommendation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id").notNull().references(() => repo.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    /** ADD | KEEP | UPGRADE | RECONFIGURE | REPLACE | REMOVE | INVESTIGATE | NO_ACTION. */
    action: text("action").notNull(),
    componentId: uuid("component_id").references(() => aiComponent.id, { onDelete: "set null" }),
    /** What need/problem this addresses — required, shown first in the UI (transparency contract). */
    need: text("need").notNull(),
    rationale: text("rationale"),
    /** DRAFT | READY_FOR_DECISION | ACCEPTED | REJECTED | MODIFIED_AND_ACCEPTED | POSTPONED | SUPERSEDED. */
    status: text("status").notNull().default("READY_FOR_DECISION"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("repo_ai_recommendation_repo_idx").on(t.repoId, t.status), tenantPolicy("repo_ai_recommendation_tenant_isolation")],
).enableRLS();

/**
 * Repo-AI-management's own audit trail. Deliberately NOT written into
 * `event_log`: that table is WorkItem-scoped by design (architecture
 * non-negotiable #1, "one append-only timeline per WorkItem") and a
 * repository-level action (inventory sync, knowledge regeneration,
 * recommendation decided) often has no WorkItem to attach to. This is
 * the same "no silent actions, always recorded" principle applied at
 * Repository scope instead — append-only by convention (only
 * `appendRepoAiEvent()` writes here), not yet DB-trigger-enforced like
 * `event_log` is (flagged in the implementation report as a follow-up,
 * not done this pass).
 */
export const repoAiEvent = pgTable(
  "repo_ai_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id").notNull().references(() => repo.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    /** inventory.synced | knowledge.generated | init.completed | init.skipped | recommendation.created | recommendation.decided | state.changed */
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    actorUserId: uuid("actor_user_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("repo_ai_event_repo_idx").on(t.repoId, t.occurredAt), tenantPolicy("repo_ai_event_tenant_isolation")],
).enableRLS();
