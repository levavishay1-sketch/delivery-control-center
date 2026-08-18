-- CreateEnum
CREATE TYPE "ModelSnapshotStatus" AS ENUM ('SUCCESS', 'FAILED');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'FETCH_MODEL_SNAPSHOT';

-- CreateTable
CREATE TABLE "ModelSnapshot" (
    "id" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ModelSnapshotStatus" NOT NULL,
    "rawContent" TEXT NOT NULL,
    "extractedModels" JSONB NOT NULL,
    "failureReason" TEXT,

    CONSTRAINT "ModelSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelSnapshot_status_fetchedAt_idx" ON "ModelSnapshot"("status", "fetchedAt");
