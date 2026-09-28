-- 0011 — AI-assisted flow: repo local checkout path, task origin +
-- approval + affected paths.
ALTER TABLE "repo" ADD COLUMN IF NOT EXISTS "local_path" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "affected_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;
