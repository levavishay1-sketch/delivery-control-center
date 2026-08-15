-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "aiBudgetUsd" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "Constitution" ADD COLUMN     "agentRunId" TEXT;

-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN     "agentRouting" JSONB;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "aiBudgetUsd" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "Stage" ADD COLUMN     "agentRunId" TEXT;

-- AlterTable
ALTER TABLE "StageVersion" ADD COLUMN     "agentRunId" TEXT;

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "jobId" TEXT,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "costUsd" DECIMAL(10,4),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "toolCalls" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetOverride" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "projectId" TEXT,
    "approvedByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3),
    "consumedByRunId" TEXT,

    CONSTRAINT "BudgetOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_name_key" ON "Agent"("name");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_status_idx" ON "AgentRun"("agentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetOverride_consumedByRunId_key" ON "BudgetOverride"("consumedByRunId");

-- CreateIndex
CREATE INDEX "BudgetOverride_clientId_consumed_idx" ON "BudgetOverride"("clientId", "consumed");

-- CreateIndex
CREATE INDEX "BudgetOverride_projectId_consumed_idx" ON "BudgetOverride"("projectId", "consumed");

-- AddForeignKey
ALTER TABLE "Constitution" ADD CONSTRAINT "Constitution_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageVersion" ADD CONSTRAINT "StageVersion_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetOverride" ADD CONSTRAINT "BudgetOverride_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetOverride" ADD CONSTRAINT "BudgetOverride_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetOverride" ADD CONSTRAINT "BudgetOverride_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetOverride" ADD CONSTRAINT "BudgetOverride_consumedByRunId_fkey" FOREIGN KEY ("consumedByRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
