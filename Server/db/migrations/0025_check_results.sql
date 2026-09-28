-- 0025 — the checks lifecycle: a check's pass/fail is a FACT reported by
-- Claude, kept separate from whether a human ever looked at it. And a
-- task can finish development while still failing verification — that
-- needed its own state, not a reuse of "blocked" (waiting on something
-- else) or a silent jump straight to "done".
ALTER TYPE "task_state" ADD VALUE IF NOT EXISTS 'failed_checks';--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "check_result" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "check_resolved_by" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "check_resolved_at" timestamptz;
