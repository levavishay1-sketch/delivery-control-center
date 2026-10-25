-- 0057 — a requirement has a detail of its own, separate from its title.
-- (The old server's 0056_a_requirement_has_a_detail.sql; 0056 here is users and permissions.)
--
-- Until now the "פירוט דרישה" card showed the title a second time. The detail is the
-- free text that says what is actually wanted; the title stays the short name. Nullable:
-- an existing requirement simply has no detail yet. Adds a column only.
ALTER TABLE "workitem" ADD COLUMN IF NOT EXISTS "description" text;
