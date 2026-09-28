ALTER TABLE "repository_onboarding_run" ADD COLUMN IF NOT EXISTS "mode" text DEFAULT 'initial' NOT NULL;--> statement-breakpoint
ALTER TABLE "repository_onboarding_run" ADD COLUMN IF NOT EXISTS "previous_run_id" uuid;--> statement-breakpoint
ALTER TABLE "repository_onboarding_run" ADD COLUMN IF NOT EXISTS "automation" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "repository_onboarding_run" ADD COLUMN IF NOT EXISTS "review_note" text;--> statement-breakpoint
DROP INDEX IF EXISTS "repository_onboarding_run_live_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repository_onboarding_run_live_uq" ON "repository_onboarding_run" USING btree ("repo_id") WHERE status in ('Pending','Running','WaitingForUser','AwaitingExternal');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repository_ai_artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"artifact_key" text NOT NULL,
	"kind" text NOT NULL,
	"path" text NOT NULL,
	"action" text NOT NULL,
	"loading" text NOT NULL,
	"justification" text DEFAULT '' NOT NULL,
	"consumers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"watched_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_of_truth" text,
	"estimated_tokens" integer,
	"lines" integer,
	"content_hash" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_ai_artifact_run_key_uq" UNIQUE("run_id","artifact_key")
);--> statement-breakpoint
ALTER TABLE "repository_ai_artifact" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repository_ai_artifact" ADD CONSTRAINT "repository_ai_artifact_run_id_repository_onboarding_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."repository_onboarding_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_ai_artifact" ADD CONSTRAINT "repository_ai_artifact_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_ai_artifact" ADD CONSTRAINT "repository_ai_artifact_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repository_ai_artifact_repo_idx" ON "repository_ai_artifact" ("repo_id","created_at");--> statement-breakpoint
CREATE POLICY "repository_ai_artifact_tenant_isolation" ON "repository_ai_artifact" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);
