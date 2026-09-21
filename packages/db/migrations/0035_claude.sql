-- Claude in DCC (openspec/changes/claude-in-dcc): the one ledger of calls,
-- and the conversations of the one chat. The client's month spend is a sum
-- over the ledger now, so the cached column goes.
CREATE TABLE IF NOT EXISTS "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"topic_key" text NOT NULL,
	"topic_kind" text NOT NULL,
	"topic_id" text,
	"topic_title" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"continued_from" uuid,
	"continues_as" uuid,
	"cli_session_id" text,
	"cli_baseline" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context_hash" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retain_until" timestamp with time zone,
	"visibility" text DEFAULT 'client' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claude_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_kind" text DEFAULT 'none' NOT NULL,
	"entity_id" text,
	"workitem_id" uuid,
	"screen" text,
	"capability" text NOT NULL,
	"trigger" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"parent_call_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"model_requested" text,
	"model_used" text,
	"effort" text,
	"policy_version" integer,
	"policy_rule" text,
	"num_turns" integer,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"price_list_version" integer,
	"outcome" text DEFAULT 'ok' NOT NULL,
	"error_text" text,
	"unanswered" boolean DEFAULT false NOT NULL,
	"source_ref" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claude_call" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"role" text NOT NULL,
	"kind" text DEFAULT 'answer' NOT NULL,
	"text" text NOT NULL,
	"source" text DEFAULT 'model' NOT NULL,
	"call_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"helpful" boolean,
	"helpful_source" text,
	"helpful_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_call" ADD CONSTRAINT "claude_call_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_call" ADD CONSTRAINT "claude_call_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_call" ADD CONSTRAINT "claude_call_workitem_id_workitem_id_fk" FOREIGN KEY ("workitem_id") REFERENCES "public"."workitem"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_call" ADD CONSTRAINT "claude_call_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_call_id_claude_call_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."claude_call"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_topic_idx" ON "conversation" USING btree ("client_id","topic_key","created_by","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_last_idx" ON "conversation" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claude_call_client_started_idx" ON "claude_call" USING btree ("client_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claude_call_workitem_idx" ON "claude_call" USING btree ("workitem_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claude_call_entity_idx" ON "claude_call" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claude_call_conversation_idx" ON "claude_call" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claude_call_user_idx" ON "claude_call" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "claude_call_source_ref_uq" ON "claude_call" USING btree ("source_ref") WHERE source_ref is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_message_conv_idx" ON "conversation_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE POLICY "conversation_tenant_isolation" ON "conversation" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "claude_call_tenant_isolation" ON "claude_call" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "conversation_message_tenant_isolation" ON "conversation_message" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
ALTER TABLE "client_budget" DROP COLUMN IF EXISTS "spent_usd";
