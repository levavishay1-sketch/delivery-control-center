CREATE TYPE "public"."executor" AS ENUM('human', 'ai', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."workitem_kind" AS ENUM('project', 'task', 'bug', 'change');--> statement-breakpoint
CREATE TABLE "client_budget" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"monthly_usd" numeric(10, 2) DEFAULT '300' NOT NULL,
	"spent_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"period_start" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_budget" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"for_user_id" uuid NOT NULL,
	"workitem_id" uuid,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workitem" ADD COLUMN "kind" "workitem_kind" DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE "workitem" ADD COLUMN "priority" "priority" DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "workitem" ADD COLUMN "risk" "risk_level" DEFAULT 'low' NOT NULL;--> statement-breakpoint
ALTER TABLE "workitem" ADD COLUMN "executor" "executor" DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "workitem" ADD COLUMN "budget_usd" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "workitem" ADD COLUMN "due_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workitem" ADD COLUMN "progress_pct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "client_budget" ADD CONSTRAINT "client_budget_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_for_user_id_users_id_fk" FOREIGN KEY ("for_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_workitem_id_workitem_id_fk" FOREIGN KEY ("workitem_id") REFERENCES "public"."workitem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("for_user_id","created_at");--> statement-breakpoint
CREATE POLICY "client_budget_tenant_isolation" ON "client_budget" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "notification_tenant_isolation" ON "notification" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);