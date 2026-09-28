-- 0024 — a requirement's ADO link was stored as a bare number
-- (linked_ado_id), same as task.linked_ado_id, but unlike task, no url
-- was ever kept alongside it — every place that showed a requirement's
-- TFS reference could only print "#1234" as plain text, never a link.
-- Mirrors task.ado_url exactly: stored once at link time, not recomputed
-- per read.
ALTER TABLE "workitem" ADD COLUMN IF NOT EXISTS "ado_url" text;
