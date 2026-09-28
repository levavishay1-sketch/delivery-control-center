-- 0015 — a flow run can belong to a TASK (implementation), not just to
-- the requirement (assess / breakdown). Still keyed by workitem_id so
-- the requirement's timeline can find every run under it.
ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "task_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "flow_run_task_idx" ON "flow_run" USING btree ("task_id","started_at");
