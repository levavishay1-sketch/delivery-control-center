-- CreateEnum
CREATE TYPE "ConfigScope" AS ENUM ('ORGANIZATION', 'CLIENT', 'PROJECT');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "aiBudgetUsd" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "BudgetOverride" ADD COLUMN "organizationId" TEXT;

-- CreateTable
CREATE TABLE "ConfigChange" (
    "id" TEXT NOT NULL,
    "scope" "ConfigScope" NOT NULL,
    "organizationId" TEXT,
    "clientId" TEXT,
    "projectId" TEXT,
    "field" TEXT NOT NULL,
    "oldValueUsd" DECIMAL(10,4),
    "newValueUsd" DECIMAL(10,4),
    "changedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetOverride_organizationId_consumed_idx" ON "BudgetOverride"("organizationId", "consumed");

-- CreateIndex
CREATE INDEX "ConfigChange_scope_organizationId_idx" ON "ConfigChange"("scope", "organizationId");

-- CreateIndex
CREATE INDEX "ConfigChange_scope_clientId_idx" ON "ConfigChange"("scope", "clientId");

-- CreateIndex
CREATE INDEX "ConfigChange_scope_projectId_idx" ON "ConfigChange"("scope", "projectId");

-- AddForeignKey
ALTER TABLE "BudgetOverride" ADD CONSTRAINT "BudgetOverride_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigChange" ADD CONSTRAINT "ConfigChange_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigChange" ADD CONSTRAINT "ConfigChange_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigChange" ADD CONSTRAINT "ConfigChange_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigChange" ADD CONSTRAINT "ConfigChange_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
