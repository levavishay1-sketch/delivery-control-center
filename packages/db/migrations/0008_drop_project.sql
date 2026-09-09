-- 0008 — remove the "project" layer. A client owns a forest of
-- WorkItems ("requirements"); a top-level requirement (parent_id NULL)
-- is what used to be a project. kind × level collapse into one `type`.

-- ── client gains what project used to hold ──────────────────────────
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "connector_type" "connector_type" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "ado_project_ref" text;--> statement-breakpoint

-- ── workitem: hierarchy + single type + area path ───────────────────
CREATE TYPE "public"."workitem_type" AS ENUM('epic', 'feature', 'story', 'bug', 'task', 'spike');--> statement-breakpoint
ALTER TABLE "workitem" ADD COLUMN IF NOT EXISTS "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "workitem" ADD COLUMN IF NOT EXISTS "ado_area_path" text;--> statement-breakpoint
ALTER TABLE "workitem" ADD COLUMN IF NOT EXISTS "type" "workitem_type" DEFAULT 'story' NOT NULL;--> statement-breakpoint
-- carry old data over: a bug stays a bug, otherwise the size level wins
UPDATE "workitem" SET "type" = CASE
  WHEN "kind" = 'bug' THEN 'bug'::workitem_type
  WHEN "level" IN ('epic','feature','story','task') THEN "level"::text::workitem_type
  ELSE 'story'::workitem_type END;--> statement-breakpoint

ALTER TABLE "workitem" DROP CONSTRAINT IF EXISTS "workitem_project_client_fk";--> statement-breakpoint
ALTER TABLE "workitem" DROP CONSTRAINT IF EXISTS "workitem_project_id_project_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "workitem_project_idx";--> statement-breakpoint
ALTER TABLE "workitem" DROP COLUMN IF EXISTS "project_id";--> statement-breakpoint
ALTER TABLE "workitem" DROP COLUMN IF EXISTS "kind";--> statement-breakpoint
ALTER TABLE "workitem" DROP COLUMN IF EXISTS "level";--> statement-breakpoint

ALTER TABLE "workitem" ADD CONSTRAINT "workitem_parent_id_workitem_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "public"."workitem"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workitem_client_idx" ON "workitem" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workitem_parent_idx" ON "workitem" USING btree ("parent_id");--> statement-breakpoint

-- ── drop the project layer ─────────────────────────────────────────
DROP TABLE IF EXISTS "project_repo";--> statement-breakpoint
DROP TABLE IF EXISTS "project";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."workitem_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."workitem_level";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."project_status";
