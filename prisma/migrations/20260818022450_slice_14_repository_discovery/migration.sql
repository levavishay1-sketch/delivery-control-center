-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'RUN_REPOSITORY_DISCOVERY';

-- CreateTable
CREATE TABLE "RepositoryDiscovery" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DiscoveryStatus" NOT NULL DEFAULT 'RUNNING',
    "findings" JSONB,
    "aiModel" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "costUsd" DECIMAL(10,4),
    "agentRunId" TEXT,
    "lastError" TEXT,
    "triggeredByUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RepositoryDiscovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepositoryDiscovery_repositoryId_idx" ON "RepositoryDiscovery"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryDiscovery_repositoryId_version_key" ON "RepositoryDiscovery"("repositoryId", "version");

-- AddForeignKey
ALTER TABLE "RepositoryDiscovery" ADD CONSTRAINT "RepositoryDiscovery_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryDiscovery" ADD CONSTRAINT "RepositoryDiscovery_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryDiscovery" ADD CONSTRAINT "RepositoryDiscovery_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
