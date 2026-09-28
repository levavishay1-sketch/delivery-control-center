ALTER TABLE "repository_onboarding_run" ADD COLUMN IF NOT EXISTS "model_choices" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "repository_onboarding_claude_execution" ADD COLUMN IF NOT EXISTS "effort" text;
