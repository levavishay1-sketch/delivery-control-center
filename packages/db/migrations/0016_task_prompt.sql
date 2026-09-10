-- 0016 — every task carries the exact prompt Claude will run when the
-- user approves it and hands it over. The breakdown writes it; the user
-- can edit it before approving; runImplement executes it verbatim.
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "prompt" text;
