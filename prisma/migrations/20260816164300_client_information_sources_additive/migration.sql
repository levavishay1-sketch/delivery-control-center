-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IntegrationType" ADD VALUE 'CRM';
ALTER TYPE "IntegrationType" ADD VALUE 'TEAMS';
ALTER TYPE "IntegrationType" ADD VALUE 'MCP';
ALTER TYPE "IntegrationType" ADD VALUE 'CUSTOM_API';
ALTER TYPE "IntegrationType" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "Connector" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE INDEX "Connector_clientId_idx" ON "Connector"("clientId");

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
