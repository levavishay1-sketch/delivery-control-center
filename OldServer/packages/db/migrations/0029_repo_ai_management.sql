CREATE TABLE IF NOT EXISTS "repo_ai_profile" (
	"repo_id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"state" text DEFAULT 'NOT_MANAGED' NOT NULL,
	"blocked_reason" text,
	"last_inventory_sync_at" timestamp with time zone,
	"last_inventory_sync_commit" text,
	"last_knowledge_snapshot_id" uuid,
	"review_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "repo_ai_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repo_ai_profile" ADD CONSTRAINT "repo_ai_profile_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_ai_profile" ADD CONSTRAINT "repo_ai_profile_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "repo_ai_profile_tenant_isolation" ON "repo_ai_profile" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_component_key_uq" UNIQUE("key")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repo_ai_component_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"detected_path" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "repo_ai_component_link_uq" UNIQUE("repo_id","component_id","detected_path")
);--> statement-breakpoint
ALTER TABLE "repo_ai_component_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repo_ai_component_link" ADD CONSTRAINT "repo_ai_component_link_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_ai_component_link" ADD CONSTRAINT "repo_ai_component_link_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_ai_component_link" ADD CONSTRAINT "repo_ai_component_link_component_id_ai_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."ai_component"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_ai_component_link_repo_idx" ON "repo_ai_component_link" ("repo_id");--> statement-breakpoint
CREATE POLICY "repo_ai_component_link_tenant_isolation" ON "repo_ai_component_link" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repo_knowledge_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"analyzed_commit" text,
	"previous_snapshot_id" uuid,
	"mode" text DEFAULT 'CREATE_BASELINE' NOT NULL,
	"freshness_status" text DEFAULT 'fresh' NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"coverage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"cost_usd" numeric(10, 4),
	"input_tokens" integer,
	"output_tokens" integer,
	"duration_ms" integer,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" uuid
);--> statement-breakpoint
ALTER TABLE "repo_knowledge_snapshot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repo_knowledge_snapshot" ADD CONSTRAINT "repo_knowledge_snapshot_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_knowledge_snapshot" ADD CONSTRAINT "repo_knowledge_snapshot_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_knowledge_snapshot_repo_idx" ON "repo_knowledge_snapshot" ("repo_id","generated_at");--> statement-breakpoint
CREATE POLICY "repo_knowledge_snapshot_tenant_isolation" ON "repo_knowledge_snapshot" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repo_ai_recommendation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"action" text NOT NULL,
	"component_id" uuid,
	"need" text NOT NULL,
	"rationale" text,
	"status" text DEFAULT 'READY_FOR_DECISION' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "repo_ai_recommendation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repo_ai_recommendation" ADD CONSTRAINT "repo_ai_recommendation_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_ai_recommendation" ADD CONSTRAINT "repo_ai_recommendation_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_ai_recommendation" ADD CONSTRAINT "repo_ai_recommendation_component_id_ai_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."ai_component"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_ai_recommendation_repo_idx" ON "repo_ai_recommendation" ("repo_id","status");--> statement-breakpoint
CREATE POLICY "repo_ai_recommendation_tenant_isolation" ON "repo_ai_recommendation" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repo_ai_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "repo_ai_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repo_ai_event" ADD CONSTRAINT "repo_ai_event_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_ai_event" ADD CONSTRAINT "repo_ai_event_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_ai_event_repo_idx" ON "repo_ai_event" ("repo_id","occurred_at");--> statement-breakpoint
CREATE POLICY "repo_ai_event_tenant_isolation" ON "repo_ai_event" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);
