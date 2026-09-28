-- A deleted client with history stays as a hidden row (archived_at set);
-- its name must be free for a new client, so uniqueness covers live rows only.
ALTER TABLE "client" DROP CONSTRAINT IF EXISTS "client_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_name_active_uq" ON "client" ("name") WHERE "archived_at" IS NULL;
