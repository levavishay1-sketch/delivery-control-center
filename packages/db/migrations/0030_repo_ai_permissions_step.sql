ALTER TABLE "repo_ai_profile" ADD COLUMN IF NOT EXISTS "deny_rules" jsonb;--> statement-breakpoint
ALTER TABLE "repo_ai_profile" ADD COLUMN IF NOT EXISTS "deny_rules_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repo_ai_profile" ADD COLUMN IF NOT EXISTS "deny_rules_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "repo_ai_profile" ADD COLUMN IF NOT EXISTS "bootstrap_completed_at" timestamp with time zone;
