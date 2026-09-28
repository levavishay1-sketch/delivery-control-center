-- 0009 — workitem_repo gains provenance: was the requirement↔repo link
-- declared by a person, or inferred by the pipeline (branches / affected
-- areas)? Plus who added it and when.
ALTER TABLE "workitem_repo" ADD COLUMN IF NOT EXISTS "link_kind" text DEFAULT 'declared' NOT NULL;--> statement-breakpoint
ALTER TABLE "workitem_repo" ADD COLUMN IF NOT EXISTS "added_by" uuid;--> statement-breakpoint
ALTER TABLE "workitem_repo" ADD COLUMN IF NOT EXISTS "added_at" timestamp with time zone DEFAULT now() NOT NULL;
