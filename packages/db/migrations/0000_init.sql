CREATE TYPE "public"."blocker_state" AS ENUM('open', 'answered', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('email', 'slack', 'phone', 'meeting', 'claude_session', 'git', 'ado', 'manual', 'system');--> statement-breakpoint
CREATE TYPE "public"."gap_state" AS ENUM('proposed', 'verified', 'dismissed', 'spun_off');--> statement-breakpoint
CREATE TYPE "public"."permission_level" AS ENUM('propose_only', 'execute_notify', 'execute_silent');--> statement-breakpoint
CREATE TYPE "public"."task_appetite" AS ENUM('small', 'standard', 'large');--> statement-breakpoint
CREATE TYPE "public"."task_state" AS ENUM('pending', 'in_progress', 'blocked', 'done', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."workitem_level" AS ENUM('epic', 'feature', 'story', 'task');--> statement-breakpoint
CREATE TYPE "public"."workitem_phase" AS ENUM('intake', 'shaping', 'building', 'review', 'done', 'archived');--> statement-breakpoint
CREATE TABLE "service_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"secret_ref" text NOT NULL,
	"scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "service_connection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entra_oid" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"claude_identity_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "users_entra_oid_unique" UNIQUE("entra_oid"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "client_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "client_repo" (
	"client_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_repo_client_id_repo_id_pk" PRIMARY KEY("client_id","repo_id")
);
--> statement-breakpoint
ALTER TABLE "client_repo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ado_project_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "project_client_name_uq" UNIQUE("client_id","name")
);
--> statement-breakpoint
ALTER TABLE "project" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_repo" (
	"client_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_repo_project_id_repo_id_pk" PRIMARY KEY("project_id","repo_id")
);
--> statement-breakpoint
ALTER TABLE "project_repo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "repo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"name" text NOT NULL,
	"ado_repo_ref" text,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"last_indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_name_uq" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "repo_dependency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_repo_id" uuid NOT NULL,
	"to_repo_id" uuid NOT NULL,
	"kind" text DEFAULT 'depends_on' NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_dependency_uq" UNIQUE("from_repo_id","to_repo_id","kind")
);
--> statement-breakpoint
CREATE TABLE "blocker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"workitem_id" uuid NOT NULL,
	"task_id" uuid,
	"question_type" text NOT NULL,
	"question" text NOT NULL,
	"routed_to" uuid NOT NULL,
	"answer" text,
	"answered_by" uuid,
	"state" "blocker_state" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "blocker" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "context_brief" (
	"workitem_id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"body" text NOT NULL,
	"current_as_of_event" uuid,
	"model_used" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "context_brief" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gap" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"workitem_id" uuid NOT NULL,
	"description" text NOT NULL,
	"blocking" boolean DEFAULT false NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"state" "gap_state" DEFAULT 'proposed' NOT NULL,
	"resolved_by" uuid,
	"spun_off_to" uuid,
	"proposed_by_event" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gap" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"workitem_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"intent" text NOT NULL,
	"acceptance" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"appetite" "task_appetite" DEFAULT 'standard' NOT NULL,
	"state" "task_state" DEFAULT 'pending' NOT NULL,
	"openspec_change_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_dependency" (
	"client_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	"reason" text,
	"origin_gap_id" uuid,
	CONSTRAINT "task_dependency_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id")
);
--> statement-breakpoint
ALTER TABLE "task_dependency" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workitem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"level" "workitem_level" DEFAULT 'story' NOT NULL,
	"phase" "workitem_phase" DEFAULT 'intake' NOT NULL,
	"title" text NOT NULL,
	"linked_ado_id" integer,
	"started_with_open_blocker" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workitem" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workitem_repo" (
	"client_id" uuid NOT NULL,
	"workitem_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	CONSTRAINT "workitem_repo_workitem_id_repo_id_pk" PRIMARY KEY("workitem_id","repo_id")
);
--> statement-breakpoint
ALTER TABLE "workitem_repo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"workitem_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "event_source" NOT NULL,
	"type" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"actor" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"supersedes" uuid,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "event_log_client_id_id_pk" PRIMARY KEY("client_id","id")
);
--> statement-breakpoint
ALTER TABLE "event_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_connection" ADD CONSTRAINT "service_connection_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_connection" ADD CONSTRAINT "service_connection_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_repo" ADD CONSTRAINT "client_repo_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_repo" ADD CONSTRAINT "client_repo_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repo" ADD CONSTRAINT "project_repo_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repo" ADD CONSTRAINT "project_repo_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repo" ADD CONSTRAINT "project_repo_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo" ADD CONSTRAINT "repo_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_dependency" ADD CONSTRAINT "repo_dependency_from_repo_id_repo_id_fk" FOREIGN KEY ("from_repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_dependency" ADD CONSTRAINT "repo_dependency_to_repo_id_repo_id_fk" FOREIGN KEY ("to_repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocker" ADD CONSTRAINT "blocker_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocker" ADD CONSTRAINT "blocker_workitem_id_workitem_id_fk" FOREIGN KEY ("workitem_id") REFERENCES "public"."workitem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocker" ADD CONSTRAINT "blocker_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocker" ADD CONSTRAINT "blocker_routed_to_users_id_fk" FOREIGN KEY ("routed_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocker" ADD CONSTRAINT "blocker_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_brief" ADD CONSTRAINT "context_brief_workitem_id_workitem_id_fk" FOREIGN KEY ("workitem_id") REFERENCES "public"."workitem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_brief" ADD CONSTRAINT "context_brief_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gap" ADD CONSTRAINT "gap_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gap" ADD CONSTRAINT "gap_workitem_id_workitem_id_fk" FOREIGN KEY ("workitem_id") REFERENCES "public"."workitem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gap" ADD CONSTRAINT "gap_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gap" ADD CONSTRAINT "gap_spun_off_to_workitem_id_fk" FOREIGN KEY ("spun_off_to") REFERENCES "public"."workitem"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_workitem_id_workitem_id_fk" FOREIGN KEY ("workitem_id") REFERENCES "public"."workitem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_depends_on_task_id_task_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_origin_gap_id_gap_id_fk" FOREIGN KEY ("origin_gap_id") REFERENCES "public"."gap"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workitem" ADD CONSTRAINT "workitem_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workitem" ADD CONSTRAINT "workitem_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workitem" ADD CONSTRAINT "workitem_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workitem_repo" ADD CONSTRAINT "workitem_repo_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workitem_repo" ADD CONSTRAINT "workitem_repo_workitem_id_workitem_id_fk" FOREIGN KEY ("workitem_id") REFERENCES "public"."workitem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workitem_repo" ADD CONSTRAINT "workitem_repo_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_workitem_id_workitem_id_fk" FOREIGN KEY ("workitem_id") REFERENCES "public"."workitem"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repo_dependency_from_idx" ON "repo_dependency" USING btree ("from_repo_id");--> statement-breakpoint
CREATE INDEX "repo_dependency_to_idx" ON "repo_dependency" USING btree ("to_repo_id");--> statement-breakpoint
CREATE INDEX "blocker_open_idx" ON "blocker" USING btree ("routed_to") WHERE state = 'open';--> statement-breakpoint
CREATE INDEX "gap_workitem_idx" ON "gap" USING btree ("workitem_id");--> statement-breakpoint
CREATE INDEX "task_workitem_idx" ON "task" USING btree ("workitem_id","seq");--> statement-breakpoint
CREATE INDEX "workitem_project_idx" ON "workitem" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workitem_owner_idx" ON "workitem" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "event_log_workitem_idx" ON "event_log" USING btree ("workitem_id","occurred_at");--> statement-breakpoint
CREATE INDEX "event_log_unassigned_idx" ON "event_log" USING btree ("client_id","recorded_at") WHERE workitem_id IS NULL;--> statement-breakpoint
CREATE INDEX "event_log_occurred_idx" ON "event_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "event_log_type_idx" ON "event_log" USING btree ("type");--> statement-breakpoint
CREATE INDEX "event_log_supersedes_idx" ON "event_log" USING btree ("supersedes") WHERE supersedes IS NOT NULL;--> statement-breakpoint
CREATE POLICY "service_connection_tenant_isolation" ON "service_connection" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "client_repo_tenant_isolation" ON "client_repo" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "project_tenant_isolation" ON "project" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "project_repo_tenant_isolation" ON "project_repo" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "blocker_tenant_isolation" ON "blocker" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "context_brief_tenant_isolation" ON "context_brief" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "gap_tenant_isolation" ON "gap" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "task_tenant_isolation" ON "task" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "task_dependency_tenant_isolation" ON "task_dependency" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "workitem_tenant_isolation" ON "workitem" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "workitem_repo_tenant_isolation" ON "workitem_repo" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "event_log_tenant_isolation" ON "event_log" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);