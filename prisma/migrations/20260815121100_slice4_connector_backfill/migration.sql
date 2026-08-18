-- Data-only backfill migration, kept separate from the additive schema
-- migration (20260815120809_slice4_connector_framework) per this project's
-- own convention of never combining schema and data migrations (Slice 2/3
-- precedent — see e.g. 20260815093611_slice3_agentrun_backfill).
--
-- Creates exactly one Connector per existing Project, copying
-- integrationType -> type and integrationConfig -> config (design.md
-- Migration Plan step 2). Project.integrationType/integrationConfig are
-- NOT dropped here — application code cutover (this same task group) reads
-- through Connector from here on; the columns themselves are dropped in a
-- later cleanup migration only once that cutover is verified working
-- end-to-end (design.md Migration Plan step 4).

INSERT INTO "Connector" (
  "id", "projectId", "type", "mode", "authType", "syncMode",
  "capabilities", "config", "status", "lastSyncAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  p."id",
  p."integrationType",
  'PULL',
  CASE p."integrationType"
    WHEN 'JIRA' THEN 'api_token'
    WHEN 'AZURE_DEVOPS' THEN 'pat'
    WHEN 'GITHUB' THEN 'token'
    ELSE 'none'
  END,
  'MANUAL',
  '[]'::jsonb,
  p."integrationConfig",
  CASE WHEN p."integrationType" != 'MANUAL' THEN 'CONNECTED'::"ConnectorStatus" ELSE 'DISCONNECTED'::"ConnectorStatus" END,
  NULL,
  now(),
  now()
FROM "Project" p
WHERE NOT EXISTS (SELECT 1 FROM "Connector" c WHERE c."projectId" = p."id");
