import { db } from "@/lib/db";

/** A project's connector, if the backfill/getOrCreate path has run for it. */
export function getConnector(projectId: string) {
  return db.connector.findUnique({ where: { projectId } });
}

/** A project's SyncRun history, most recent first. */
export function listSyncRuns(connectorId: string) {
  return db.syncRun.findMany({ where: { connectorId }, orderBy: { startedAt: "desc" } });
}

/** Whether a connector already has a SyncRun in flight — used to keep triggerSync from double-enqueueing. */
export function getRunningSyncRun(connectorId: string) {
  return db.syncRun.findFirst({ where: { connectorId, status: "RUNNING" } });
}

/** The SyncRun tracking a given Job's attempt-cycle, if one has been started yet. */
export function getSyncRunByJobId(jobId: string) {
  return db.syncRun.findFirst({ where: { jobId } });
}
