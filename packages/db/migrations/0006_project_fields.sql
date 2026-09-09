CREATE TYPE "public"."connector_type" AS ENUM('manual', 'ado', 'github', 'jira', 'dcc');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planning', 'active', 'blocked', 'done');--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "connector_type" "connector_type" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "status" "project_status" DEFAULT 'planning' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "budget_usd" numeric(12, 2);