/*
  Warnings:

  - Made the column `clientId` on table `Connector` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Connector" ALTER COLUMN "clientId" SET NOT NULL;
