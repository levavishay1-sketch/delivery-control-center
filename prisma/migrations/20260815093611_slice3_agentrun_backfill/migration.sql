-- Data-only backfill migration, kept separate from the additive schema
-- migration (20260815093426_slice3_agent_run_budget_models) per this
-- project's own convention of never combining schema and data migrations.
--
-- For every Stage/Constitution row with drafting data (aiModel IS NOT NULL),
-- creates an Agent (upserted by name — historically only aiModel, a single
-- string, was recorded, so name doubles as the dedup key; provider is
-- inferred from the only two executors this codebase has ever had: rows
-- named like "mock*" get provider "mock", everything else gets "claude")
-- and one AgentRun per source row (status SUCCEEDED, retryCount 0 — no
-- historical retry count was ever captured, see design.md decision 2),
-- then links the source row's agentRunId to it.

-- 1. Seed one Agent per distinct historical aiModel value, if not already present.
INSERT INTO "Agent" ("id", "name", "provider", "model", "isDefault", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  t."aiModel",
  CASE WHEN t."aiModel" LIKE 'mock%' THEN 'mock' ELSE 'claude' END,
  t."aiModel",
  false,
  now(),
  now()
FROM (
  SELECT DISTINCT "aiModel" FROM "Stage" WHERE "aiModel" IS NOT NULL
  UNION
  SELECT DISTINCT "aiModel" FROM "Constitution" WHERE "aiModel" IS NOT NULL
) t
WHERE NOT EXISTS (SELECT 1 FROM "Agent" a WHERE a."name" = t."aiModel");

-- 2. Backfill Stage -> AgentRun.
CREATE TEMP TABLE "_stage_run_backfill" AS
SELECT s."id" AS "stageId", gen_random_uuid()::text AS "runId", a."id" AS "agentId"
FROM "Stage" s
JOIN "Agent" a ON a."name" = s."aiModel"
WHERE s."aiModel" IS NOT NULL AND s."agentRunId" IS NULL;

INSERT INTO "AgentRun" (
  "id", "agentId", "jobId", "status", "promptTokens", "completionTokens",
  "costUsd", "retryCount", "lastError", "toolCalls", "startedAt", "completedAt", "createdAt"
)
SELECT
  b."runId", b."agentId", NULL, 'SUCCEEDED', s."promptTokens", s."completionTokens",
  s."costUsd", 0, NULL, NULL, COALESCE(s."startedAt", s."createdAt"), COALESCE(s."completedAt", s."updatedAt"), s."createdAt"
FROM "_stage_run_backfill" b
JOIN "Stage" s ON s."id" = b."stageId";

UPDATE "Stage" s
SET "agentRunId" = b."runId"
FROM "_stage_run_backfill" b
WHERE s."id" = b."stageId";

DROP TABLE "_stage_run_backfill";

-- 3. Backfill Constitution -> AgentRun. Constitution has no startedAt/
-- completedAt columns of its own; createdAt is used as the best-effort
-- stand-in for both (the row's creation is when its draft completed).
CREATE TEMP TABLE "_constitution_run_backfill" AS
SELECT c."id" AS "constitutionId", gen_random_uuid()::text AS "runId", a."id" AS "agentId"
FROM "Constitution" c
JOIN "Agent" a ON a."name" = c."aiModel"
WHERE c."aiModel" IS NOT NULL AND c."agentRunId" IS NULL;

INSERT INTO "AgentRun" (
  "id", "agentId", "jobId", "status", "promptTokens", "completionTokens",
  "costUsd", "retryCount", "lastError", "toolCalls", "startedAt", "completedAt", "createdAt"
)
SELECT
  b."runId", b."agentId", NULL, 'SUCCEEDED', c."promptTokens", c."completionTokens",
  c."costUsd", 0, NULL, NULL, c."createdAt", c."createdAt", c."createdAt"
FROM "_constitution_run_backfill" b
JOIN "Constitution" c ON c."id" = b."constitutionId";

UPDATE "Constitution" c
SET "agentRunId" = b."runId"
FROM "_constitution_run_backfill" b
WHERE c."id" = b."constitutionId";

DROP TABLE "_constitution_run_backfill";
