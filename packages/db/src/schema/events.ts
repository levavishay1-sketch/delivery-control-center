import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { eventSource } from "./enums.ts";
import { client } from "./tenancy.ts";
import { workitem } from "./workitem.ts";

/**
 * ─────────────────────────────────────────────────────────────────────
 *  event_log — the spine (architecture decision 01)
 * ─────────────────────────────────────────────────────────────────────
 *
 * Append-only. Never UPDATE, never DELETE — a correction is a new row
 * with `supersedes` pointing at the old one. Enforced by triggers in
 * sql/guards.sql (Drizzle does not manage triggers), so an ORM bug
 * cannot mutate history.
 *
 * Two timestamps, both indexed:
 *   - occurred_at : when the thing actually happened (a phone call at
 *                   09:30 logged at 14:00 has occurred_at = 09:30)
 *   - recorded_at : when we learned about it (DB default now())
 *
 * `workitem_id` is nullable → the "unassigned" bucket: an incoming
 * message that has no confident WorkItem match sits here until a human
 * decides (architecture §11).
 *
 * `type` is free text, not an enum — a new event type must not require a
 * migration. `payload` is jsonb but every write is validated against a
 * per-type Zod schema at the application boundary (see src/events/),
 * versioned by `schema_version`. That validation is the discipline that
 * keeps payload from becoming a junk drawer (decision 01 risk).
 *
 * The primary key is (client_id, id) so the table can be RANGE/LIST
 * partitioned by client_id later without a key change. Not partitioned
 * yet — pilot scale does not need it.
 */
export const eventLog = pgTable(
  "event_log",
  {
    id: uuid("id").notNull().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    workitemId: uuid("workitem_id").references(() => workitem.id, { onDelete: "set null" }),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),

    source: eventSource("source").notNull(),
    type: text("type").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),

    /**
     * Who did it. Always resolves to a real person, even for background
     * work (architecture decision 02):
     *   { kind: "user", userId, identityType: "interactive" }
     *   { kind: "delegated", userId, identityType: "delegated", triggeredBy }
     *   { kind: "system", process }        // transport plumbing only
     */
    actor: jsonb("actor").$type<EventActor>().notNull(),

    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),

    /** Set when this row corrects/replaces an earlier one. */
    supersedes: uuid("supersedes"),

    /** Typed cross-references: PRs, ADO items, gaps, tasks, other events. */
    links: jsonb("links").$type<EventLink[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    primaryKey({ columns: [t.clientId, t.id] }),
    index("event_log_workitem_idx").on(t.workitemId, t.occurredAt),
    index("event_log_unassigned_idx")
      .on(t.clientId, t.recordedAt)
      .where(sql`workitem_id IS NULL`),
    index("event_log_occurred_idx").on(t.occurredAt),
    index("event_log_type_idx").on(t.type),
    index("event_log_supersedes_idx").on(t.supersedes).where(sql`supersedes IS NOT NULL`),
    pgPolicy("event_log_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`client_id = current_setting('app.current_client', true)::uuid`,
      withCheck: sql`client_id = current_setting('app.current_client', true)::uuid`,
    }),
  ],
).enableRLS();

export type EventActor =
  | { kind: "user"; userId: string; identityType: "interactive" }
  | { kind: "delegated"; userId: string; identityType: "delegated"; triggeredBy: string }
  | { kind: "system"; process: string };

export type EventLink = {
  rel:
    | "supersedes"
    | "pull_request"
    | "ado_workitem"
    | "gap"
    | "task"
    | "blocker"
    | "commit"
    | "session"
    | "thread";
  ref: string;
};
