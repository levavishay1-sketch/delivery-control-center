-- CreateTable
CREATE TABLE "TaskDraft" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "materializedWorkItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskDraft_materializedWorkItemId_key" ON "TaskDraft"("materializedWorkItemId");

-- CreateIndex
CREATE INDEX "TaskDraft_stageId_idx" ON "TaskDraft"("stageId");

-- AddForeignKey
ALTER TABLE "TaskDraft" ADD CONSTRAINT "TaskDraft_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDraft" ADD CONSTRAINT "TaskDraft_materializedWorkItemId_fkey" FOREIGN KEY ("materializedWorkItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
