DROP TABLE IF EXISTS "repository_onboarding_claude_execution" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "repository_ai_artifact" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "repository_profile" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "onboarding_prompt_template" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "repository_onboarding_stage" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "repository_onboarding_run" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "repo_ai_recommendation" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "repo_knowledge_snapshot" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "repo_ai_component_link" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "ai_component" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "repo_ai_profile" CASCADE;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repository_onboarding_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"current_stage_key" text,
	"workspace_path" text,
	"default_branch" text,
	"baseline_sha" text,
	"branch_name" text,
	"automation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_choices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"session" jsonb DEFAULT '{}'::jsonb NOT NULL,
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
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result" jsonb,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_onboarding_stage_run_key_uq" UNIQUE("run_id","stage_key")
);--> statement-breakpoint
ALTER TABLE "repository_onboarding_stage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repository_onboarding_stage" ADD CONSTRAINT "repository_onboarding_stage_run_id_repository_onboarding_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."repository_onboarding_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_onboarding_stage" ADD CONSTRAINT "repository_onboarding_stage_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repository_onboarding_stage_run_order_idx" ON "repository_onboarding_stage" ("run_id","stage_order");--> statement-breakpoint
CREATE POLICY "repository_onboarding_stage_tenant_isolation" ON "repository_onboarding_stage" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);
