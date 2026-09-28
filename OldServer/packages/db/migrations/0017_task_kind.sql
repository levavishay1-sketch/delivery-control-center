-- 0017 — a breakdown node is a "task" (real work, becomes a TFS work
-- item) or a "check" (verification/regression/documentation needed to
-- consider its parent task done — never its own TFS item, folded into
-- the parent's Discussion instead). Checks never count toward the
-- ladder depth and are always leaves under a task.
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'task' NOT NULL;
