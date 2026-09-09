ALTER TABLE "workitem" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "workitem" ADD CONSTRAINT "workitem_key_unique" UNIQUE("key");