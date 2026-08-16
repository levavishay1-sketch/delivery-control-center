/*
  Warnings:

  - Made the column `clientId` on table `Repository` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Repository" ALTER COLUMN "clientId" SET NOT NULL;
