-- Widen aiBudgetUsd from Decimal(10,2) to Decimal(10,4) to match costUsd's own precision
-- (AgentRun/Stage/Constitution.costUsd is already Decimal(10,4)) — a Decimal(10,2) budget
-- silently rounded any threshold finer than a whole cent, which live testing caught: setting
-- $0.0001 rounded to $0.00 before the check ever ran. Widening precision only, no data loss.

-- AlterTable
ALTER TABLE "Client" ALTER COLUMN "aiBudgetUsd" SET DATA TYPE DECIMAL(10,4);

-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "aiBudgetUsd" SET DATA TYPE DECIMAL(10,4);
