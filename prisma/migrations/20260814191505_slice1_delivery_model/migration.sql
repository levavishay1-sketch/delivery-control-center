/*
  Warnings:

  - The `status` column on the `WorkItem` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "WorkItemType" AS ENUM ('PROJECT', 'TASK', 'BUG', 'CHANGE');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('DRAFT', 'OPEN', 'IN_PROGRESS', 'DECISION_REQUIRED', 'BLOCKED', 'REVIEW', 'APPROVED', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PriorityLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ExecutorType" AS ENUM ('HUMAN', 'AI_AGENT', 'HYBRID', 'UNASSIGNED');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "workItemId" TEXT;

-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "aiCost" DECIMAL(10,4) NOT NULL DEFAULT 0,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "executorId" TEXT,
ADD COLUMN     "executorType" "ExecutorType" NOT NULL DEFAULT 'UNASSIGNED',
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "priority" "PriorityLevel" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "risk" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "type" "WorkItemType" NOT NULL DEFAULT 'TASK',
DROP COLUMN "status",
ADD COLUMN     "status" "WorkStatus" NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "Dependency" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "dependsOnWorkItemId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blocker" (
    "id" TEXT NOT NULL,
    "blockingItemId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requiredAction" TEXT NOT NULL,
    "blockedSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "impact" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Blocker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "aiRecommendation" TEXT,
    "aiConfidence" DECIMAL(5,2),
    "deadline" TIMESTAMP(3),
    "approverId" TEXT,
    "status" "DecisionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dependency_workItemId_dependsOnWorkItemId_key" ON "Dependency"("workItemId", "dependsOnWorkItemId");

-- CreateIndex
CREATE INDEX "Blocker_blockingItemId_resolvedAt_idx" ON "Blocker"("blockingItemId", "resolvedAt");

-- CreateIndex
CREATE INDEX "Decision_workItemId_status_idx" ON "Decision"("workItemId", "status");

-- CreateIndex
CREATE INDEX "AuditEvent_workItemId_createdAt_idx" ON "AuditEvent"("workItemId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkItem_projectId_status_idx" ON "WorkItem"("projectId", "status");

-- CreateIndex
CREATE INDEX "WorkItem_parentId_idx" ON "WorkItem"("parentId");

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dependency" ADD CONSTRAINT "Dependency_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dependency" ADD CONSTRAINT "Dependency_dependsOnWorkItemId_fkey" FOREIGN KEY ("dependsOnWorkItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blocker" ADD CONSTRAINT "Blocker_blockingItemId_fkey" FOREIGN KEY ("blockingItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blocker" ADD CONSTRAINT "Blocker_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
