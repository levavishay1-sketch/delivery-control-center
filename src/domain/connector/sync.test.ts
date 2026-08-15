import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { completeSyncRun, failSyncRun, getOrCreateConnectorForProject, startSyncRun, triggerSync } from "./commands";
import { runConnectorSync } from "./sync";
import { createProject } from "@/domain/project/commands";
import { enqueueJob, failJob } from "@/domain/job/commands";
import type { AuthContext } from "@/domain/shared/context";
import { ConflictError } from "@/domain/shared/errors";

/**
 * Integration tests against a real local Postgres — same rationale as the
 * other domain test suites in this project.
 */

let clientId: string;
let managerCtx: AuthContext;

const orgIds: string[] = [];
const jobIds: string[] = [];

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "Sync Test Org", slug: `sync-test-org-${Date.now()}` } });
  orgIds.push(org.id);
  const client = await db.client.create({ data: { organizationId: org.id, name: "Sync Test Client", slug: "sync-test" } });
  clientId = client.id;

  const manager = await db.user.create({ data: { email: `sync-manager-${Date.now()}@test.local`, name: "Sync Manager" } });
  await db.clientMembership.create({ data: { userId: manager.id, clientId, role: "MANAGER" } });
  managerCtx = { userId: manager.id, displayName: "Sync Manager", isOrgAdmin: false, memberships: [{ clientId, role: "MANAGER" }] };
});

afterAll(async () => {
  if (jobIds.length > 0) {
    await db.job.deleteMany({ where: { id: { in: jobIds } } });
  }
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
});

function makeProject(name: string) {
  return createProject(managerCtx, {
    clientId,
    name,
    key: `${name.replace(/[^A-Z]/gi, "").slice(0, 6).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
  });
}

async function makeJob(connectorId: string) {
  const job = await enqueueJob("SYNC_PROJECT", { connectorId }, `sync-test-${connectorId}-${Date.now()}-${Math.random()}`);
  jobIds.push(job.id);
  return job;
}

describe("runConnectorSync", () => {
  it("syncs a MANUAL connector with zero items and no error", async () => {
    const project = await makeProject("Sync Manual Project");
    const connector = await getOrCreateConnectorForProject(project.id);
    const counts = await runConnectorSync(connector.id);
    expect(counts).toEqual({ itemsCreated: 0, itemsUpdated: 0, itemsConflicted: 0 });
  });
});

describe("SyncRun lifecycle", () => {
  it("triggerSync creates exactly one SyncRun per attempt-cycle, surviving retries without duplicating", async () => {
    const project = await makeProject("SyncRun Lifecycle Project");
    const connector = await getOrCreateConnectorForProject(project.id);
    const job = await makeJob(connector.id);

    const attempt1 = await startSyncRun(connector.id, job.id);
    const attempt2 = await startSyncRun(connector.id, job.id); // simulates a retry re-invoking the handler
    expect(attempt2.id).toBe(attempt1.id);
    expect(await db.syncRun.count({ where: { jobId: job.id } })).toBe(1);
  });

  it("a successful sync marks the SyncRun SUCCEEDED and the Connector CONNECTED with lastSyncAt set", async () => {
    const project = await makeProject("SyncRun Success Project");
    const connector = await getOrCreateConnectorForProject(project.id);
    const job = await makeJob(connector.id);

    const run = await startSyncRun(connector.id, job.id);
    const counts = await runConnectorSync(connector.id);
    const completed = await completeSyncRun(run.id, counts);

    expect(completed.status).toBe("SUCCEEDED");
    expect(completed.completedAt).not.toBeNull();

    const updatedConnector = await db.connector.findUniqueOrThrow({ where: { id: connector.id } });
    expect(updatedConnector.status).toBe("CONNECTED");
    expect(updatedConnector.lastSyncAt).not.toBeNull();
  });

  it("exhausted retries mark the SyncRun FAILED with the last error, and the Connector ERROR", async () => {
    const project = await makeProject("SyncRun Exhausted Project");
    const connector = await getOrCreateConnectorForProject(project.id);
    const job = await makeJob(connector.id);
    const run = await startSyncRun(connector.id, job.id);

    const failed = await failSyncRun(run.id, "adapter unreachable");
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toBe("adapter unreachable");
    expect(failed.completedAt).not.toBeNull();

    const updatedConnector = await db.connector.findUniqueOrThrow({ where: { id: connector.id } });
    expect(updatedConnector.status).toBe("ERROR");
  });

  it("a non-exhausted job failure leaves the SyncRun untouched and RUNNING", async () => {
    const project = await makeProject("SyncRun Retry Project");
    const connector = await getOrCreateConnectorForProject(project.id);
    const job = await makeJob(connector.id);
    const run = await startSyncRun(connector.id, job.id);

    // Simulates worker.ts's processJob: a retryable job failure (attempts < maxAttempts) never
    // calls failSyncRun — only handleSyncProjectExhausted (called on final exhaustion) does.
    const retried = await failJob(job.id, "transient network error");
    expect(retried.status).toBe("QUEUED");

    const untouched = await db.syncRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(untouched.status).toBe("RUNNING");
    expect(untouched.completedAt).toBeNull();
  });
});

describe("triggerSync", () => {
  it("refuses a second trigger while one SyncRun is already RUNNING for the connector", async () => {
    const project = await makeProject("Trigger Sync Concurrency Project");
    const connector = await getOrCreateConnectorForProject(project.id);
    const job = await makeJob(connector.id);
    await startSyncRun(connector.id, job.id); // simulates an in-flight sync

    await expect(triggerSync(managerCtx, connector.id)).rejects.toThrow(ConflictError);
  });

  it("enqueues a SYNC_PROJECT job when no sync is currently running", async () => {
    const project = await makeProject("Trigger Sync Success Project");
    const connector = await getOrCreateConnectorForProject(project.id);

    const job = await triggerSync(managerCtx, connector.id);
    jobIds.push(job.id);
    expect(job.type).toBe("SYNC_PROJECT");
    expect((job.payload as { connectorId: string }).connectorId).toBe(connector.id);
  });
});
