CREATE TYPE "requirement_type" AS ENUM ('development', 'research', 'testing');--> statement-breakpoint
ALTER TABLE "workitem" ADD COLUMN IF NOT EXISTS "requirement_type" "requirement_type" NOT NULL DEFAULT 'development';
