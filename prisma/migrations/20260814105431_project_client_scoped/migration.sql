-- Make Project.clientId required now that the backfill
-- (prisma/migrate-backfill-default-client.ts) has assigned every existing
-- project to the default client.
ALTER TABLE "Project" ALTER COLUMN "clientId" SET NOT NULL;

-- Replace the global-unique project key with per-client uniqueness.
DROP INDEX "Project_key_key";
CREATE UNIQUE INDEX "Project_clientId_key_key" ON "Project"("clientId", "key");
