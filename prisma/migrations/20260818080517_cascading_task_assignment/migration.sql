-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('EXPLICIT', 'INHERITED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "defaultExecutorId" TEXT,
ADD COLUMN     "defaultExecutorType" "ExecutorType" NOT NULL DEFAULT 'UNASSIGNED';

-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "assignmentSource" "AssignmentSource" NOT NULL DEFAULT 'INHERITED';

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_defaultExecutorId_fkey" FOREIGN KEY ("defaultExecutorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
