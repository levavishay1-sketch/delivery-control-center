-- Data-only backfill migration, kept separate from the additive schema
-- migration (20260816164300_client_information_sources_additive) per this
-- project's own convention of never combining schema and data migrations
-- (Slice 3/4/12 precedent — see e.g. 20260816155855_repository_client_backfill).
--
-- Sets Connector.clientId for every existing row via
-- projectId -> project.clientId (design.md's Risks section: every Connector
-- has a required projectId, every Project a required clientId, so this
-- covers every row by construction). The follow-up migration in this same
-- task group makes clientId NOT NULL once this has run.

UPDATE "Connector" c
SET "clientId" = p."clientId"
FROM "Project" p
WHERE p."id" = c."projectId"
  AND c."clientId" IS NULL;
