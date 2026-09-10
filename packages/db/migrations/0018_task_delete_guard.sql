-- 0018 — close a cascade landmine: parent_task_id was ON DELETE CASCADE,
-- so deleting one task silently deleted its whole subtree — including
-- already-approved, already-TFS-linked, or already-implemented children —
-- with no warning and no way to undo it. Deletion of a task with children
-- is now RESTRICTed at the database level; the application (deleteTask)
-- walks and clears a subtree explicitly and surgically before deleting
-- the row, never relying on cascade.
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_parent_task_id_task_id_fk";--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_parent_task_id_task_id_fk"
  FOREIGN KEY ("parent_task_id") REFERENCES "public"."task"("id") ON DELETE restrict ON UPDATE no action;
