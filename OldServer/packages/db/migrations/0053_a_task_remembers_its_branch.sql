-- 0053 — a task's branch is a fact recorded when it is created, not a name
-- worked out again each time.
--
-- The name was computed from the requirement's key and the task's own wording.
-- Both can change (a requirement gets its real key; the instruction is
-- edited), and the computed name then pointed at a branch that did not exist:
-- the task looked as if it had never been developed, or as if it changed
-- nothing. The branch a run created is stored here and read from here.
-- Null until a run creates one — the repair step fills it for older tasks.
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "branch" text;
