-- 0013 — a flow run is one background call to the local `claude` CLI
-- (assess / breakdown). It records the full activity log so the user
-- can leave the screen and come back to everything Claude did.
-- No RLS: written as single auto-committed statements (never inside a
-- withTenant tx — PGlite's one connection can't nest), scoped by
-- workitem_id which the API already tenant-checks.
CREATE TABLE IF NOT EXISTS "flow_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"workitem_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "flow_run_workitem_idx" ON "flow_run" USING btree ("workitem_id","started_at");
