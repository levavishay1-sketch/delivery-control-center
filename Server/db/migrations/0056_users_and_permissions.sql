-- 0056 — users, identities, teams, security roles and who holds them where
-- (openspec/changes/users-and-permissions).
--
-- Every table here is org-global, like `users` itself: a person, a team or a
-- security role works across clients, so none of them is tenant-scoped and
-- none carries an RLS policy. Access to them is gated by permissions in the
-- API (`users.manage`, `teams.manage`, `roles.manage`). What a person may do
-- INSIDE a client is still walled by RLS on the tenant tables.

-- ── users: the kinds of principal, expiry, and the permission version ──
-- kind: person (a real person), guest (an Entra B2B guest, usually with an
-- expiry), agent (an AI agent — see agent_profile).
-- perm_version rises on every change to what the user may do; a token that
-- carries an older one is refused as stale (401 token_stale).
ALTER TABLE "users" ALTER COLUMN "entra_oid" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kind" text DEFAULT 'person' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_kind_check" CHECK ("kind" IN ('person', 'guest', 'agent'));
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perm_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" (lower("email"));
--> statement-breakpoint

-- ── user_identity: the ways one person signs in ────────────────────────
-- One row per (provider, subject). A person may hold several: a local
-- password now, Entra later, perhaps Google. Adding a provider adds rows,
-- never columns on users.
CREATE TABLE "user_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"provider" text NOT NULL CHECK ("provider" IN ('local', 'entra', 'google', 'apple')),
	"subject" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "user_identity_provider_subject_uq" UNIQUE ("provider", "subject")
);
--> statement-breakpoint
CREATE INDEX "user_identity_user_idx" ON "user_identity" ("user_id");
--> statement-breakpoint

-- ── local_credential: a password, until Entra is set up ────────────────
-- Only the hash (ASP.NET Core Identity's PasswordHasher, PBKDF2) is kept.
-- failed_count / locked_until: five wrong passwords lock the account.
CREATE TABLE "local_credential" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"password_hash" text NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ── team / team_member ─────────────────────────────────────────────────
-- source 'entra': the team mirrors an Entra group (external_id = its id)
-- and its members are kept in step by the directory sync.
-- client_id set: the team belongs to one client (optional).
CREATE TABLE "team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" text DEFAULT 'local' NOT NULL CHECK ("source" IN ('local', 'entra')),
	"external_id" text,
	"client_id" uuid REFERENCES "client"("id") ON DELETE restrict,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "team_entra_has_external_id" CHECK ("source" <> 'entra' OR "external_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "team_external_uq" ON "team" ("source", "external_id") WHERE "external_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "team_name_active_uq" ON "team" (lower("name")) WHERE "archived_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "team_member" (
	"team_id" uuid NOT NULL REFERENCES "team"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"source" text DEFAULT 'local' NOT NULL CHECK ("source" IN ('local', 'entra')),
	"added_by" uuid REFERENCES "users"("id"),
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("team_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX "team_member_user_idx" ON "team_member" ("user_id");
--> statement-breakpoint

-- ── permission: the catalog ────────────────────────────────────────────
-- Written in code (Dcc.Domain Permissions) and synced here on every start.
-- A permission nothing in the code checks would mean nothing, so the UI
-- never invents one — it composes security roles from this list.
CREATE TABLE "permission" (
	"code" text PRIMARY KEY NOT NULL,
	"area" text NOT NULL,
	"description_key" text NOT NULL
);
--> statement-breakpoint

-- ── security_role: a named set of permissions ──────────────────────────
-- assignable_scopes: where the role may be assigned (global / client /
-- requirement). Built-in roles are synced from code and cannot be edited.
CREATE TABLE "security_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"description" text,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"assignable_scopes" text[] DEFAULT '{global,client,requirement}' NOT NULL,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_role_builtin_has_key" CHECK (NOT "is_builtin" OR "key" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "security_role_key_uq" ON "security_role" ("key") WHERE "key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "security_role_name_uq" ON "security_role" (lower("name"));
--> statement-breakpoint
CREATE TABLE "security_role_permission" (
	"security_role_id" uuid NOT NULL REFERENCES "security_role"("id") ON DELETE cascade,
	"permission_code" text NOT NULL REFERENCES "permission"("code") ON DELETE cascade,
	PRIMARY KEY ("security_role_id", "permission_code")
);
--> statement-breakpoint

-- ── security_role_assignment: who holds which role, where ──────────────
-- The heart of the model. principal = a user or a team; scope = global
-- (everywhere), a client, or a requirement (and everything under it).
CREATE TABLE "security_role_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_type" text NOT NULL CHECK ("principal_type" IN ('user', 'team')),
	"principal_id" uuid NOT NULL,
	"security_role_id" uuid NOT NULL REFERENCES "security_role"("id") ON DELETE cascade,
	"scope_type" text NOT NULL CHECK ("scope_type" IN ('global', 'client', 'requirement')),
	"scope_id" uuid,
	"expires_at" timestamp with time zone,
	"granted_by" uuid REFERENCES "users"("id"),
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_role_assignment_scope_id" CHECK (("scope_type" = 'global') = ("scope_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "security_role_assignment_uq" ON "security_role_assignment"
	("principal_type", "principal_id", "security_role_id", "scope_type", coalesce("scope_id", '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
CREATE INDEX "security_role_assignment_principal_idx" ON "security_role_assignment" ("principal_type", "principal_id");
--> statement-breakpoint

-- ── agent_profile: an AI agent's owner or sponsor ──────────────────────
-- delegated: acts on behalf of owner_user_id and never exceeds the owner's
-- permissions (architecture decision 02). independent: its own
-- assignments, with a named person accountable (sponsor_user_id); switching
-- to it is gated until the decision-02 amendment is approved.
CREATE TABLE "agent_profile" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"mode" text DEFAULT 'delegated' NOT NULL CHECK ("mode" IN ('delegated', 'independent')),
	"owner_user_id" uuid REFERENCES "users"("id"),
	"sponsor_user_id" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_profile_delegated_has_owner" CHECK ("mode" <> 'delegated' OR "owner_user_id" IS NOT NULL),
	CONSTRAINT "agent_profile_independent_has_sponsor" CHECK ("mode" <> 'independent' OR "sponsor_user_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "agent_profile_owner_idx" ON "agent_profile" ("owner_user_id");
--> statement-breakpoint

-- ── user_token: every token that is kept (only its hash) ───────────────
-- refresh: one per sign-in, rotated on every use; family_id ties a chain,
--          and presenting a token that was already rotated revokes the chain.
-- api:     long-lived, for agents, hooks and the MCP server.
-- The access token (JWT) is never stored — it is verified by its signature.
CREATE TABLE "user_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"type" text NOT NULL CHECK ("type" IN ('refresh', 'api')),
	"token_hash" text NOT NULL,
	"name" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"family_id" uuid,
	"replaced_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "user_token_hash_uq" UNIQUE ("token_hash"),
	CONSTRAINT "user_token_refresh_has_family" CHECK ("type" <> 'refresh' OR "family_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "user_token_user_idx" ON "user_token" ("user_id", "type");
--> statement-breakpoint
CREATE INDEX "user_token_family_idx" ON "user_token" ("family_id") WHERE "family_id" IS NOT NULL;
--> statement-breakpoint

-- ── audit_log: every change to identity and permissions ────────────────
-- Org-level, append-only (guards.sql). "No silent actions."
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid REFERENCES "users"("id"),
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text
);
--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" ("at");
--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" ("target_type", "target_id");
