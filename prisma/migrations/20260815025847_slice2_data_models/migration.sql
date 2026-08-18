-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('DRAFT_STAGE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConstitutionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StageVersionTrigger" AS ENUM ('DRAFT', 'REDRAFT');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('INFO', 'WARNING', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterEnum
ALTER TYPE "StageStatus" ADD VALUE 'AWAITING_CLARIFICATION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StageType" ADD VALUE 'CLARIFY';
ALTER TYPE "StageType" ADD VALUE 'ANALYZE';
ALTER TYPE "StageType" ADD VALUE 'IMPLEMENT';

-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN     "constitutionVersion" INTEGER,
ADD COLUMN     "stageSequence" "StageType"[];

-- Backfill: every pipeline created before Slice 2 ran the historical
-- CONSTITUTION -> SPEC -> PLAN -> TASKS -> DEPLOY sequence. stageSequence
-- is set NOT NULL in a follow-up migration once this backfill has run.
UPDATE "Pipeline"
SET "stageSequence" = ARRAY['CONSTITUTION', 'SPEC', 'PLAN', 'TASKS', 'DEPLOY']::"StageType"[]
WHERE "stageSequence" IS NULL;

-- CreateTable
CREATE TABLE "Constitution" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT,
    "status" "ConstitutionStatus" NOT NULL DEFAULT 'DRAFT',
    "aiModel" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "costUsd" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "Constitution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageVersion" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "content" TEXT,
    "aiModel" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "costUsd" DECIMAL(10,4),
    "createdAsResultOf" "StageVersionTrigger" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClarifyQuestion" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "answeredByUserId" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClarifyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisFinding" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "relatedStageType" "StageType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Constitution_projectId_version_key" ON "Constitution"("projectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "StageVersion_stageId_versionNumber_key" ON "StageVersion"("stageId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Job_idempotencyKey_key" ON "Job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Job_status_scheduledAt_idx" ON "Job"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "Constitution" ADD CONSTRAINT "Constitution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageVersion" ADD CONSTRAINT "StageVersion_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClarifyQuestion" ADD CONSTRAINT "ClarifyQuestion_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClarifyQuestion" ADD CONSTRAINT "ClarifyQuestion_answeredByUserId_fkey" FOREIGN KEY ("answeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisFinding" ADD CONSTRAINT "AnalysisFinding_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
