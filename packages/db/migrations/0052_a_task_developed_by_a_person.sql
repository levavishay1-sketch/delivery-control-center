-- 0052 — a task can be developed by a person, not by Claude.
--
-- Not every task is developed with Claude, and not every task is one that
-- compiles. A task marked this way is developed by whoever picks it up: they
-- report what they did (recorded as a development run marked manual, so the
-- status, the steps and the checks read it like any other), and they can set
-- each of its checks by hand. The mark is the only thing stored here.
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "developed_manually" boolean DEFAULT false NOT NULL;
