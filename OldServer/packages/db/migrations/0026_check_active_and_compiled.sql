ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "was_done" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "compiled_components" jsonb NOT NULL DEFAULT '[]'::jsonb;
