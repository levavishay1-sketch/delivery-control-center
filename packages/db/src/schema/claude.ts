import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { client } from "./tenancy.ts";
import { users } from "./identity.ts";
import { workitem } from "./workitem.ts";

/**
 * Claude in DCC (`openspec/changes/claude-in-dcc`): one ledger row per call
 * to Claude from any route, and the conversations of the one chat.
 *
 * Every table is tenant-scoped (`client_id` + RLS). `claude_call` is
 * append-only — a cost record is money and is never edited or deleted, not
 * even by retention; the triggers live in `sql/guards.sql`. Only
 * `recordClaudeCall()` (src/ledger) writes it.
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
 * A conversation of the one chat. The topic is derived from the screen the
 * person was on (`wi:<id>`, `task:<id>`, `pr:<repo>/<n>`, `run:<id>`,
 * `app`) — never chosen by the person. The transcript here is what the
 * person sees; the model's context is the CLI session (`cli_session_id`),
 * and a roll-over starts a new conversation without touching this one.
 */
export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    topicKey: text("topic_key").notNull(),
    /** wi | task | pr | run | app */
    topicKind: text("topic_kind").notNull(),
    topicId: text("topic_id"),
    topicTitle: text("topic_title").notNull().default(""),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    /** active | rolled | archived */
    status: text("status").notNull().default("active"),
    continuedFrom: uuid("continued_from"),
    continuesAs: uuid("continues_as"),
    cliSessionId: text("cli_session_id"),
    /** What the CLI already reported for `cli_session_id` (cumulative) — the
     *  baseline the next call's row is the difference from. Bookkeeping, not
     *  a total: the money is in `claude_call`. */
    cliBaseline: jsonb("cli_baseline").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /** Hash of the screen context last handed to the model — only what changed is sent. */
    contextHash: text("context_hash"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    retainUntil: timestamp("retain_until", { withTimezone: true }),
    /** Reserved for who may read it (claude-in-dcc §10.3). */
    visibility: text("visibility").notNull().default("client"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversation_topic_idx").on(t.clientId, t.topicKey, t.createdBy, t.status),
    index("conversation_last_idx").on(t.lastMessageAt),
    tenantPolicy("conversation_tenant_isolation"),
  ],
).enableRLS();

/**
 * One call to Claude. Column names follow the OpenTelemetry GenAI
 * conventions where one exists, so the ledger can be exported without a
 * mapping layer. `cost_usd` is what the CLI reported for this call (for a
 * resumed session, the difference from the previous row); the price list
 * version lets it be recomputed from the tokens.
 */
export const claudeCall = pgTable(
  "claude_call",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    /** The person behind the call — always a real person (decision 02). */
    userId: uuid("user_id").notNull().references(() => users.id),
    /** workitem | task | pull_request | onboarding_run | conversation | none */
    entityKind: text("entity_kind").notNull().default("none"),
    entityId: text("entity_id"),
    workitemId: uuid("workitem_id").references(() => workitem.id, { onDelete: "set null" }),
    /** The screen the call was made from, when there was one. */
    screen: text("screen"),
    capability: text("capability").notNull(),
    /** button | chat | rollover | insights | session | hook */
    trigger: text("trigger").notNull(),
    label: text("label").notNull().default(""),
    conversationId: uuid("conversation_id").references(() => conversation.id, { onDelete: "set null" }),
    messageId: uuid("message_id"),
    parentCallId: uuid("parent_call_id"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer("duration_ms"),
    modelRequested: text("model_requested"),
    modelUsed: text("model_used"),
    effort: text("effort"),
    policyVersion: integer("policy_version"),
    /** What the routing policy decided and why ("default sonnet for decomposition; escalated (openGaps)"). */
    policyRule: text("policy_rule"),
    numTurns: integer("num_turns"),

    inputTokens: integer("input_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    priceListVersion: integer("price_list_version"),

    /** ok | error | timeout | stopped | refused */
    outcome: text("outcome").notNull().default("ok"),
    errorText: text("error_text"),
    /** The model said it did not have what was asked — a candidate fact for the screen (§7.2). */
    unanswered: boolean("unanswered").notNull().default(false),
    /** `event:<id>` / `run:<id>` for rows back-filled from older records — unique, so never counted twice. */
    sourceRef: text("source_ref"),
    /** Small structured extras a reader groups by — the onboarding stage, the task number. Never money. */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index("claude_call_client_started_idx").on(t.clientId, t.startedAt),
    index("claude_call_workitem_idx").on(t.workitemId, t.startedAt),
    index("claude_call_entity_idx").on(t.entityKind, t.entityId),
    index("claude_call_conversation_idx").on(t.conversationId),
    index("claude_call_user_idx").on(t.userId, t.startedAt),
    uniqueIndex("claude_call_source_ref_uq").on(t.sourceRef).where(sql`source_ref is not null`),
    tenantPolicy("claude_call_tenant_isolation"),
  ],
).enableRLS();

/**
 * One message of a conversation — what the person sees. `source = system`
 * means the answer came from the screen's glossary or facts with no model
 * call; `call_id` links a model answer to its ledger row. `payload` holds a
 * proposal or a declared cost as data, never as a decision that lives only
 * here (§11.2): the proposal runs through the action registry.
 */
export const conversationMessage = pgTable(
  "conversation_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    /** user | assistant | system */
    role: text("role").notNull(),
    /** answer | proposal | declared_cost | refusal | system_note */
    kind: text("kind").notNull().default("answer"),
    text: text("text").notNull(),
    /** model | system */
    source: text("source").notNull().default("model"),
    callId: uuid("call_id").references(() => claudeCall.id, { onDelete: "set null" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    helpful: boolean("helpful"),
    /** person | reasked — who said it did not help */
    helpfulSource: text("helpful_source"),
    helpfulNote: text("helpful_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversation_message_conv_idx").on(t.conversationId, t.createdAt),
    tenantPolicy("conversation_message_tenant_isolation"),
  ],
).enableRLS();

/**
 * A question that repeats on a screen (claude-in-dcc §9.3–§9.4): the
 * cluster (screen × normalised question) the control center's SQL found,
 * the finding and recommendation a `usage_insights` call worded for it, and
 * what was done about it. A repeated question is a gap in the product, not
 * in Claude — so the way out is an improvement task, not a better answer.
 * Editable: a conclusion is not money.
 */
export const claudeInsight = pgTable(
  "claude_insight",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().references(() => client.id, { onDelete: "restrict" }),
    screen: text("screen").notNull(),
    /** The question with case, punctuation and spacing normalised — the cluster's key. */
    questionKey: text("question_key").notNull(),
    /** One of the original questions, as a person wrote it. */
    sampleQuestion: text("sample_question").notNull(),
    /** How many times it had been asked when last analysed. */
    count: integer("count").notNull().default(0),
    firstAskedAt: timestamp("first_asked_at", { withTimezone: true }),
    lastAskedAt: timestamp("last_asked_at", { withTimezone: true }),
    finding: text("finding"),
    recommendation: text("recommendation"),
    /** The `usage_insights` call that worded the finding — its cost is on the ledger. */
    analysedCallId: uuid("analysed_call_id").references(() => claudeCall.id, { onDelete: "set null" }),
    /** open | task_opened | dismissed */
    status: text("status").notNull().default("open"),
    /** The improvement task opened from it, on the internal client. */
    workitemId: uuid("workitem_id").references(() => workitem.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("claude_insight_cluster_uq").on(t.clientId, t.screen, t.questionKey),
    index("claude_insight_status_idx").on(t.clientId, t.status),
    tenantPolicy("claude_insight_tenant_isolation"),
  ],
).enableRLS();
