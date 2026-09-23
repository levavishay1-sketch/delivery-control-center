-- A requirement's real content is usually in the attached spec. DCC now
-- holds the file itself (so a client with no Azure DevOps connection can
-- attach one at all) and the text read out of it, which is what assess and
-- breakdown send to Claude.
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "content" bytea;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "extracted_text" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN IF NOT EXISTS "extract_error" text;
