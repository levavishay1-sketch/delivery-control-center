import { sql } from "drizzle-orm";
import { jsonb, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { client } from "./tenancy.ts";

/**
 * A person. Identity is anchored to the org SSO (Entra ID) and, for
 * anyone who runs Claude, to their own Claude identity via OAuth — a
 * reference, never credentials (architecture decision 02).
 *
 * `users` is org-global, not tenant-scoped: a person works across
 * clients. RLS therefore does not apply here; access is gated at the
 * application layer.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  entraOid: text("entra_oid").notNull().unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  /** Opaque reference to this user's linked Claude identity. Null until linked. */
  claudeIdentityRef: text("claude_identity_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
});

/**
 * A connection to a client's external system (CRM, ERP, third-party API)
 * or an MCP server. This is TRANSPORT, not reasoning: it holds a pointer
 * to a secret in the vault, never the secret itself, and never appears
 * as an `actor` on a reasoning event (architecture §4, §13).
 *
 * Tenant-scoped: a connection belongs to exactly one client.
 */
export const serviceConnection = pgTable(
  "service_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    /** e.g. "crm", "erp", "mcp:playwright" */
    kind: text("kind").notNull(),
    displayName: text("display_name").notNull(),
    /**
     * The secret. In production this is a Key Vault path resolved at use
     * time; in the local pilot the PAT / token is stored here directly.
     */
    secretRef: text("secret_ref").notNull(),
    /** Minimal scope this connection is allowed to request. */
    scope: jsonb("scope").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Non-secret connection detail: { orgUrl, project } for ADO, etc. */
    config: jsonb("config").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    /** Result of the last connectivity check. */
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastCheckOk: text("last_check_ok"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  () => [
    pgPolicy("service_connection_tenant_isolation", {
      as: "permissive",
      for: "all",
      to: "public",
      using: sql`client_id = current_setting('app.current_client', true)::uuid`,
      withCheck: sql`client_id = current_setting('app.current_client', true)::uuid`,
    }),
  ],
).enableRLS();
