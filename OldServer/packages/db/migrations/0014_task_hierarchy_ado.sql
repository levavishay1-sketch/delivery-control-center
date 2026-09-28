-- 0014 — tasks become a HIERARCHY, and they are the entity that syncs to
-- TFS (a requirement is a DCC-only pre-stage and is never pushed).
--
-- The depth of the task tree picks the TFS work-item types off the Agile
-- ladder Epic > Feature > User Story > Task, bottom-anchored:
--   depth 1 → Task
--   depth 2 → User Story, Task
--   depth 3 → Feature, User Story, Task
--   depth 4 → Epic, Feature, User Story, Task
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "parent_task_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "ado_type" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "linked_ado_id" integer;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "ado_url" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "ado_synced_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "task" ADD CONSTRAINT "task_parent_task_id_task_id_fk"
    FOREIGN KEY ("parent_task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_parent_idx" ON "task" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_ado_idx" ON "task" USING btree ("linked_ado_id");
