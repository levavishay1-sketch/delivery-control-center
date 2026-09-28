CREATE TABLE IF NOT EXISTS "repository_onboarding_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"current_stage_key" text,
	"onboarding_version" text DEFAULT 'v1' NOT NULL,
	"workspace_kind" text,
	"workspace_path" text,
	"default_branch" text,
	"baseline_sha" text,
	"branch_name" text,
	"triggered_by" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "repository_onboarding_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repository_onboarding_run" ADD CONSTRAINT "repository_onboarding_run_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_onboarding_run" ADD CONSTRAINT "repository_onboarding_run_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_onboarding_run" ADD CONSTRAINT "repository_onboarding_run_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_onboarding_run" ADD CONSTRAINT "repository_onboarding_run_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repository_onboarding_run_repo_idx" ON "repository_onboarding_run" ("repo_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repository_onboarding_run_live_uq" ON "repository_onboarding_run" USING btree ("repo_id") WHERE status in ('Pending','Running','WaitingForUser');--> statement-breakpoint
CREATE POLICY "repository_onboarding_run_tenant_isolation" ON "repository_onboarding_run" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repository_onboarding_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"stage_order" integer NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"input_version" text,
	"result" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claude_execution_id" uuid,
	"source_commit_sha" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_onboarding_stage_run_key_uq" UNIQUE("run_id","stage_key")
);--> statement-breakpoint
ALTER TABLE "repository_onboarding_stage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repository_onboarding_stage" ADD CONSTRAINT "repository_onboarding_stage_run_id_repository_onboarding_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."repository_onboarding_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_onboarding_stage" ADD CONSTRAINT "repository_onboarding_stage_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repository_onboarding_stage_run_order_idx" ON "repository_onboarding_stage" ("run_id","stage_order");--> statement-breakpoint
CREATE POLICY "repository_onboarding_stage_tenant_isolation" ON "repository_onboarding_stage" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repository_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"scanned_commit_sha" text NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"build_systems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"test_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ci_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"framework_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"docs_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ignored_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_profile_run_id_unique" UNIQUE("run_id")
);--> statement-breakpoint
ALTER TABLE "repository_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repository_profile" ADD CONSTRAINT "repository_profile_run_id_repository_onboarding_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."repository_onboarding_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_profile" ADD CONSTRAINT "repository_profile_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_profile" ADD CONSTRAINT "repository_profile_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repository_profile_repo_idx" ON "repository_profile" ("repo_id","created_at");--> statement-breakpoint
CREATE POLICY "repository_profile_tenant_isolation" ON "repository_profile" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "onboarding_prompt_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_key" text NOT NULL,
	"version" integer NOT NULL,
	"stage" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"default_model" text,
	"active" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_prompt_template_key_version_uq" UNIQUE("prompt_key","version")
);--> statement-breakpoint
ALTER TABLE "onboarding_prompt_template" ADD CONSTRAINT "onboarding_prompt_template_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_prompt_template_active_uq" ON "onboarding_prompt_template" USING btree ("prompt_key") WHERE active is true;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repository_onboarding_claude_execution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"repo_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"prompt_template_id" uuid NOT NULL,
	"model" text,
	"permission_profile" text NOT NULL,
	"deny_rules_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'Running' NOT NULL,
	"result_text" text,
	"result_json" jsonb,
	"cost_usd" numeric(10, 4),
	"input_tokens" integer,
	"output_tokens" integer,
	"duration_ms" integer,
	"num_turns" integer,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "repository_onboarding_claude_execution" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repository_onboarding_claude_execution" ADD CONSTRAINT "repository_onboarding_claude_execution_run_id_repository_onboarding_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."repository_onboarding_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_onboarding_claude_execution" ADD CONSTRAINT "repository_onboarding_claude_execution_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_onboarding_claude_execution" ADD CONSTRAINT "repository_onboarding_claude_execution_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_onboarding_claude_execution" ADD CONSTRAINT "repository_onboarding_claude_execution_prompt_template_id_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "public"."onboarding_prompt_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repository_onboarding_claude_execution_run_idx" ON "repository_onboarding_claude_execution" ("run_id","stage_key");--> statement-breakpoint
CREATE POLICY "repository_onboarding_claude_execution_tenant_isolation" ON "repository_onboarding_claude_execution" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);
