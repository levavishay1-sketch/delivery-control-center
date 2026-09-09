import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Tenancy model (architecture decision 04).
 *
 *   client ─┬─ project ─── workitem ─── task
 *           └─ (client_repo) ── repo        repo.client_id NULL = org-shared
 *                                project ─ (project_repo) ─ repo
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

export const client = pgTable("client", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});
// `client` itself is the tenant root. RLS on `client` restricts a
// tenant-scoped connection to its own row; org-admin tooling connects
// without the session var set and sees all rows (policy yields false →
// handled by a separate admin path, not modelled here yet).

export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** ADO project reference (e.g. "Medipharm.Portal"). */
    adoProjectRef: text("ado_project_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    unique("project_client_name_uq").on(t.clientId, t.name),
    // F-6: lets child rows enforce "same client all the way down"
    unique("project_id_client_uq").on(t.id, t.clientId),
    tenantPolicy("project_tenant_isolation"),
  ],
).enableRLS();

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

/** Which repos a project touches. */
export const projectRepo = pgTable(
  "project_repo",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repo.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.repoId] }),
    tenantPolicy("project_repo_tenant_isolation"),
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
