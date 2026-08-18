-- CreateEnum
CREATE TYPE "ConnectorMode" AS ENUM ('PULL', 'PUSH', 'BOTH');

-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProvenanceSource" AS ENUM ('SYNC', 'MANUAL');

-- CreateEnum
CREATE TYPE "ConflictResolution" AS ENUM ('KEPT_MANUAL', 'ACCEPTED_INCOMING');

-- AlterEnum
ALTER TYPE "IntegrationType" ADD VALUE 'GITHUB';

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'SYNC_PROJECT';

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "IntegrationType" NOT NULL DEFAULT 'MANUAL',
    "mode" "ConnectorMode" NOT NULL DEFAULT 'PULL',
    "authType" TEXT NOT NULL,
    "syncMode" "SyncMode" NOT NULL DEFAULT 'MANUAL',
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "config" JSONB,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "jobId" TEXT,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "itemsUpdated" INTEGER NOT NULL DEFAULT 0,
    "itemsConflicted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldProvenance" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "source" "ProvenanceSource" NOT NULL,
    "externalId" TEXT,
    "actorUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "currentValue" TEXT NOT NULL,
    "incomingValue" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolution" "ConflictResolution",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Connector_projectId_key" ON "Connector"("projectId");

-- CreateIndex
CREATE INDEX "SyncRun_connectorId_status_idx" ON "SyncRun"("connectorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FieldProvenance_workItemId_field_key" ON "FieldProvenance"("workItemId", "field");

-- CreateIndex
CREATE INDEX "SyncConflict_connectorId_resolvedAt_idx" ON "SyncConflict"("connectorId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncConflict_workItemId_field_key" ON "SyncConflict"("workItemId", "field");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_connectorId_deliveryId_key" ON "WebhookDelivery"("connectorId", "deliveryId");

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldProvenance" ADD CONSTRAINT "FieldProvenance_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldProvenance" ADD CONSTRAINT "FieldProvenance_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
