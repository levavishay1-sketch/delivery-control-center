-- Claude in DCC, stage 4 (openspec/changes/claude-in-dcc): a repeated
-- question becomes a conclusion with a finding, a recommendation and what
-- was done about it; a client may keep its conversations for a period of
-- its own instead of the policy's default.
CREATE TABLE IF NOT EXISTS "claude_insight" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"screen" text NOT NULL,
	"question_key" text NOT NULL,
	"sample_question" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"first_asked_at" timestamp with time zone,
	"last_asked_at" timestamp with time zone,
	"finding" text,
	"recommendation" text,
	"analysed_call_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"workitem_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claude_insight" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claude_insight" ADD CONSTRAINT "claude_insight_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_insight" ADD CONSTRAINT "claude_insight_analysed_call_id_claude_call_id_fk" FOREIGN KEY ("analysed_call_id") REFERENCES "public"."claude_call"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_insight" ADD CONSTRAINT "claude_insight_workitem_id_workitem_id_fk" FOREIGN KEY ("workitem_id") REFERENCES "public"."workitem"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_insight" ADD CONSTRAINT "claude_insight_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "claude_insight_cluster_uq" ON "claude_insight" USING btree ("client_id","screen","question_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claude_insight_status_idx" ON "claude_insight" USING btree ("client_id","status");--> statement-breakpoint
CREATE POLICY "claude_insight_tenant_isolation" ON "claude_insight" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "chat_retention_days" integer;
