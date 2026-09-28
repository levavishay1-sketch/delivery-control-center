import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  numeric,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { connectorType } from "./enums.ts";

/**
 * Tenancy model (architecture decision 04, revised).
 *
 *   client ─┬─ workitem ─┬─ workitem (parent_id, a tree)
 *           │            └─ task
 *           └─ (client_repo) ── repo    repo.client_id NULL = org-shared
 *
 * There is no "project" layer. A client owns a forest of WorkItems
 * ("requirements"); a top-level requirement (parent_id NULL) is what
 * used to be a project. Grouping, budget roll-up and ADO area paths all
 * ride the tree.
 *
 * The wall between clients (decision 03) is a `client_id` column on every
 * tenant-scoped row + a Postgres RLS policy keyed on the
 * `app.current_client` session variable. The app connects as a
 * non-superuser role without BYPASSRLS, so an application bug cannot
 * leak across the wall — the database refuses.
 *
 * The `client_id` NULL escape hatch on `repo` (org-shared libraries /
 * infra) is safe ONLY because work and events are always scoped by
 * `workitem.client_id`, never by `repo.client_id`. A repo is a resource
 * pointer, not a tenant boundary.
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
 * `archived_at` set ⇒ the client was deleted but has history the system
 * must keep (event_log, claude_call are append-only). The row stays,
 * hidden everywhere, and its name is free for a new client.
 */
export const client = pgTable("client", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** How this client's requirements sync outward (was project.connector_type). */
  connectorType: connectorType("connector_type").notNull().default("manual"),
  /** ADO project reference for sync, e.g. "Altshuler Trade". */
  adoProjectRef: text("ado_project_ref"),
  /** How many days this client's chat conversations are kept; NULL ⇒ the policy's default (claude-in-dcc §9.10). */
  chatRetentionDays: integer("chat_retention_days"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [uniqueIndex("client_name_active_uq").on(t.name).where(sql`${t.archivedAt} is null`)]);
// `client` itself is the tenant root. RLS on `client` restricts a
// tenant-scoped connection to its own row; org-admin tooling connects
// without the session var set and sees all rows (policy yields false →
// handled by a separate admin path, not modelled here yet).

/**
 * A repository. `client_id` NULL ⇒ org-shared (Shared.Libraries, Infra).
 * NOT tenant-scoped by RLS — a shared repo has no single owner, and the
 * safety rule above keeps that from being a hole.
 */
export const repo = pgTable(
  "repo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").references(() => client.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    adoRepoRef: text("ado_repo_ref"),
    /** Local working copy on the machine running DCC — where `claude` runs
     *  for repo-aware assessment / breakdown. Cloned from the git url if unset. */
    localPath: text("local_path"),
    defaultBranch: text("default_branch").notNull().default("main"),
    /** Nullable until first index; drives the "last indexed" visibility (architecture risks). */
    lastIndexedAt: timestamp("last_indexed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("repo_name_uq").on(t.name)],
);

/**
 * "This client's work uses these repos." Always a manual, explicit,
 * audited action — never guessed by AI (architecture §8, GitOps).
 */
export const clientRepo = pgTable(
  "client_repo",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repo.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.clientId, t.repoId] }),
    tenantPolicy("client_repo_tenant_isolation"),
  ],
).enableRLS();

/**
 * Cross-repo dependency map. Hand-curated at first; an input to the
 * contention map and the Flow view (architecture §7, §15).
 */
export const repoDependency = pgTable(
  "repo_dependency",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromRepoId: uuid("from_repo_id")
      .notNull()
      .references(() => repo.id, { onDelete: "cascade" }),
    toRepoId: uuid("to_repo_id")
      .notNull()
      .references(() => repo.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("depends_on"),
    note: text("note"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("repo_dependency_uq").on(t.fromRepoId, t.toRepoId, t.kind),
    index("repo_dependency_from_idx").on(t.fromRepoId),
    index("repo_dependency_to_idx").on(t.toRepoId),
  ],
);
