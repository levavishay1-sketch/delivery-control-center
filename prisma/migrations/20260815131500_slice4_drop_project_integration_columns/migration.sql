-- Cleanup migration (design.md Migration Plan step 4): drops Project.integrationType/
-- integrationConfig now that Connector is the sole source of truth for a project's external
-- tracker connection, and every Project row has a backfilled Connector (verified: 48/48, no
-- orphans, before this migration ran).

ALTER TABLE "Project" DROP COLUMN "integrationType";
ALTER TABLE "Project" DROP COLUMN "integrationConfig";
