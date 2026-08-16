-- Data-only backfill migration, kept separate from the additive schema
-- migration (20260816155815_client_repository_model_additive) per this
-- project's own convention of never combining schema and data migrations
-- (Slice 3/4 precedent — see e.g. 20260815121100_slice4_connector_backfill).
--
-- Sets Repository.clientId for every existing row via
-- connectorId -> connector.projectId -> project.clientId (design.md's Risks
-- section: every Repository has a connectorId, every Connector a projectId,
-- every Project a clientId — all required, non-nullable FKs already — so
-- this covers every row by construction). The follow-up migration in this
-- same task group makes clientId NOT NULL once this has run.

UPDATE "Repository" r
SET "clientId" = p."clientId"
FROM "Connector" c
JOIN "Project" p ON p."id" = c."projectId"
WHERE c."id" = r."connectorId"
  AND r."clientId" IS NULL;
